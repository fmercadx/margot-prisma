import { Platform } from 'react-native';

import { disableDailyReminder, enableDailyReminder, isReminderScheduled } from '../src/lib/reminders';

// The suite runs once as iOS and once as Android (see package.json).
const N = jest.requireMock('expo-notifications');
const onAndroid = Platform.OS === 'android' ? test : test.skip;
const onIOS = Platform.OS === 'ios' ? test : test.skip;

const notYetAsked = { granted: false, canAskAgain: true, status: 'undetermined' };
const denied = { granted: false, canAskAgain: false, status: 'denied' };

beforeEach(async () => {
  jest.clearAllMocks();
  await disableDailyReminder();
});

test('schedules one daily 8 PM reminder, and re-enabling replaces it', async () => {
  expect(await enableDailyReminder()).toBe('enabled');
  expect(await enableDailyReminder()).toBe('enabled');
  expect(N.__scheduled.size).toBe(1);
  expect(await isReminderScheduled()).toBe(true);

  const [req] = N.__scheduled.values();
  expect(req.trigger).toMatchObject({ type: 'daily', hour: 20, minute: 0 });

  await disableDailyReminder();
  expect(await isReminderScheduled()).toBe(false);
});

test('a refused permission schedules nothing', async () => {
  N.getPermissionsAsync.mockResolvedValueOnce(denied);
  expect(await enableDailyReminder()).toBe('denied');
  expect(N.requestPermissionsAsync).not.toHaveBeenCalled(); // cannot ask again
  expect(N.__scheduled.size).toBe(0);
});

onAndroid('Android: the channel exists before permission is requested', async () => {
  // Android 13+ shows no permission prompt for an app with no channel.
  N.getPermissionsAsync.mockResolvedValueOnce(notYetAsked);
  expect(await enableDailyReminder()).toBe('enabled');

  const channel = N.setNotificationChannelAsync.mock.invocationCallOrder[0];
  const request = N.requestPermissionsAsync.mock.invocationCallOrder[0];
  expect(channel).toBeLessThan(request);

  const [req] = N.__scheduled.values();
  expect(req.trigger.channelId).toBe(N.setNotificationChannelAsync.mock.calls[0][0]);
});

onIOS('iOS: no channel, and the prompt is shown when not yet asked', async () => {
  N.getPermissionsAsync.mockResolvedValueOnce(notYetAsked);
  expect(await enableDailyReminder()).toBe('enabled');
  expect(N.setNotificationChannelAsync).not.toHaveBeenCalled();
  expect(N.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  const [req] = N.__scheduled.values();
  expect(req.trigger.channelId).toBeUndefined();
});
