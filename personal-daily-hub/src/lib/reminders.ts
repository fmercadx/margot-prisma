// An opt-in daily reminder, water reminders, a wind-down reminder and the
// end of a focus session, scheduled locally with expo-notifications.
// Nothing is sent to a server and no push token is requested.
//
// Whether the reminder is on is read back from the OS's list of scheduled
// notifications rather than stored separately, so the toggle cannot drift
// out of step with what will actually fire.

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const REMINDER_ID = 'pdh-daily-reminder';
const CHANNEL_ID = 'daily-reminder';
const FOCUS_ID = 'pdh-focus-end';
const FOCUS_CHANNEL_ID = 'focus-timer';
const WATER_PREFIX = 'pdh-water-';
const WATER_CHANNEL_ID = 'water-reminders';
const WIND_DOWN_ID = 'pdh-wind-down';
const WIND_DOWN_CHANNEL_ID = 'wind-down';

/** When water reminders come: every two hours through the day. */
export const WATER_REMINDER_HOURS: readonly number[] = [10, 12, 14, 16, 18];
/** How far ahead they are scheduled; opening the app tops them up. */
export const WATER_REMINDER_DAYS = 7;
export const REMINDER_MINUTE = 0;

/** Local scheduled notifications do not exist on the web build. */
export const remindersSupported = Platform.OS === 'ios' || Platform.OS === 'android';

let handlerSet = false;
function ensureHandler() {
  if (handlerSet) return;
  handlerSet = true;
  // Show the reminder even if it fires while the app is open.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

export async function isReminderScheduled(): Promise<boolean> {
  if (!remindersSupported) return false;
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    return scheduled.some((n) => n.identifier === REMINDER_ID);
  } catch {
    return false;
  }
}

export type EnableResult = 'enabled' | 'denied' | 'unsupported' | 'failed';

/** "8 PM" */
export function hourLabel(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** Creates the channel (Android 13+ only prompts once one exists), then asks if need be. */
async function permitted(channelId: string, channelName: string): Promise<boolean> {
  ensureHandler();
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(channelId, {
      name: channelName,
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  let perm = await Notifications.getPermissionsAsync();
  if (!perm.granted && perm.canAskAgain) perm = await Notifications.requestPermissionsAsync();
  return perm.granted;
}

/**
 * Schedules (or moves) the daily reminder to `hour`:00. Reusing the
 * identifier replaces any earlier schedule rather than adding a second.
 */
export async function enableDailyReminder(hour: number): Promise<EnableResult> {
  if (!remindersSupported) return 'unsupported';
  try {
    if (!(await permitted(CHANNEL_ID, 'Daily reminder'))) return 'denied';

    await Notifications.scheduleNotificationAsync({
      identifier: REMINDER_ID,
      content: {
        title: 'How did today go?',
        body: 'Take a minute to log your water, habits and spending.',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour,
        minute: REMINDER_MINUTE,
        channelId: Platform.OS === 'android' ? CHANNEL_ID : undefined,
      },
    });
    return 'enabled';
  } catch (err) {
    console.warn('[reminders] could not schedule', err);
    return 'failed';
  }
}

/**
 * A notification for when a focus session ends, so it is heard with the
 * phone locked or the app closed. It says nothing about what the focus was:
 * lock screens are read by whoever picks the phone up.
 */
export async function scheduleFocusEnd(endsAt: number, minutes: number): Promise<EnableResult> {
  if (!remindersSupported) return 'unsupported';
  try {
    if (!(await permitted(FOCUS_CHANNEL_ID, 'Focus timer'))) return 'denied';
    await Notifications.scheduleNotificationAsync({
      identifier: FOCUS_ID,
      content: { title: 'Focus session done', body: `${minutes} minutes of focus. Time for a short break.` },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: endsAt,
        channelId: Platform.OS === 'android' ? FOCUS_CHANNEL_ID : undefined,
      },
    });
    return 'enabled';
  } catch (err) {
    console.warn('[reminders] could not schedule the focus timer', err);
    return 'failed';
  }
}

export async function cancelFocusEnd(): Promise<void> {
  if (!remindersSupported) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(FOCUS_ID);
  } catch (err) {
    console.warn('[reminders] could not cancel the focus timer', err);
  }
}

/**
 * The water reminders still to come, for `days` days from `now`. Today's
 * are left out once the goal is reached, so they stop for the day. Pure.
 */
export function waterReminderTimes(now: Date, goalMetToday: boolean, days = WATER_REMINDER_DAYS): Date[] {
  const out: Date[] = [];
  for (let d = goalMetToday ? 1 : 0; d < days; d++) {
    for (const hour of WATER_REMINDER_HOURS) {
      const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d, hour, 0, 0, 0);
      if (at.getTime() > now.getTime()) out.push(at);
    }
  }
  return out;
}

const waterId = (at: Date) =>
  `${WATER_PREFIX}${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}-${at.getHours()}`;

/** Removes every scheduled water reminder. */
export async function cancelWaterReminders(): Promise<void> {
  if (!remindersSupported) return;
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      scheduled
        .filter((n) => n.identifier.startsWith(WATER_PREFIX))
        .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
    );
  } catch (err) {
    console.warn('[reminders] could not cancel water reminders', err);
  }
}

/**
 * Replaces the water reminders with a fresh week of them. Called when they
 * are switched on, at each launch, and when today's goal is reached or
 * lost again. The wording is fixed: it never says how much was drunk.
 */
export async function scheduleWaterReminders(now: Date, goalMetToday: boolean): Promise<EnableResult> {
  if (!remindersSupported) return 'unsupported';
  try {
    if (!(await permitted(WATER_CHANNEL_ID, 'Water reminders'))) return 'denied';
    await cancelWaterReminders();
    for (const at of waterReminderTimes(now, goalMetToday)) {
      await Notifications.scheduleNotificationAsync({
        identifier: waterId(at),
        content: { title: 'Time for a glass of water', body: 'A quick sip keeps the day going.' },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: at.getTime(),
          channelId: Platform.OS === 'android' ? WATER_CHANNEL_ID : undefined,
        },
      });
    }
    return 'enabled';
  } catch (err) {
    console.warn('[reminders] could not schedule water reminders', err);
    return 'failed';
  }
}

/** "10:30 PM", for a time given in minutes after midnight. */
export function minutesLabel(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * A daily nudge to start getting ready for bed, at `minutes` after
 * midnight. Reusing the identifier moves an earlier one rather than adding
 * a second. The wording is fixed: it says nothing about the day logged.
 */
export async function scheduleWindDown(minutes: number): Promise<EnableResult> {
  if (!remindersSupported) return 'unsupported';
  try {
    if (!(await permitted(WIND_DOWN_CHANNEL_ID, 'Wind-down reminder'))) return 'denied';
    await Notifications.scheduleNotificationAsync({
      identifier: WIND_DOWN_ID,
      content: { title: 'Time to wind down', body: 'Screens down, lights low. A good night starts now.' },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: Math.floor(minutes / 60),
        minute: minutes % 60,
        channelId: Platform.OS === 'android' ? WIND_DOWN_CHANNEL_ID : undefined,
      },
    });
    return 'enabled';
  } catch (err) {
    console.warn('[reminders] could not schedule the wind-down reminder', err);
    return 'failed';
  }
}

export async function cancelWindDown(): Promise<void> {
  if (!remindersSupported) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(WIND_DOWN_ID);
  } catch (err) {
    console.warn('[reminders] could not cancel the wind-down reminder', err);
  }
}

export async function disableDailyReminder(): Promise<void> {
  if (!remindersSupported) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(REMINDER_ID);
  } catch (err) {
    console.warn('[reminders] could not cancel', err);
  }
}
