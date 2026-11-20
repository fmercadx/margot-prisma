// An opt-in daily reminder, and the end of a focus session, scheduled
// locally with expo-notifications. Nothing is sent to a server and no push
// token is requested.
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

export async function disableDailyReminder(): Promise<void> {
  if (!remindersSupported) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(REMINDER_ID);
  } catch (err) {
    console.warn('[reminders] could not cancel', err);
  }
}
