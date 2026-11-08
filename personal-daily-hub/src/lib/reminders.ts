// An opt-in daily reminder, scheduled locally with expo-notifications.
// Nothing is sent to a server and no push token is requested.
//
// Whether the reminder is on is read back from the OS's list of scheduled
// notifications rather than stored separately, so the toggle cannot drift
// out of step with what will actually fire.

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const REMINDER_ID = 'pdh-daily-reminder';
const CHANNEL_ID = 'daily-reminder';
export const REMINDER_HOUR = 20;
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

export async function enableDailyReminder(): Promise<EnableResult> {
  if (!remindersSupported) return 'unsupported';
  try {
    ensureHandler();
    // Android 13+ only shows the permission prompt once a channel exists.
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: 'Daily reminder',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    let perm = await Notifications.getPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return 'denied';

    // Reusing the identifier replaces any earlier schedule rather than doubling it.
    await Notifications.scheduleNotificationAsync({
      identifier: REMINDER_ID,
      content: {
        title: 'How did today go?',
        body: 'Take a minute to log your water, habits and spending.',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: REMINDER_HOUR,
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

export async function disableDailyReminder(): Promise<void> {
  if (!remindersSupported) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(REMINDER_ID);
  } catch (err) {
    console.warn('[reminders] could not cancel', err);
  }
}
