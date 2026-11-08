// Native modules have no implementation under Jest; these stand in for them.

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

// An in-memory notification scheduler, so reminder tests can see what would fire.
jest.mock('expo-notifications', () => {
  const scheduled = new Map();
  const granted = { granted: true, canAskAgain: true, status: 'granted' };
  return {
    __scheduled: scheduled,
    setNotificationHandler: jest.fn(),
    setNotificationChannelAsync: jest.fn(async () => null),
    getPermissionsAsync: jest.fn(async () => granted),
    requestPermissionsAsync: jest.fn(async () => granted),
    scheduleNotificationAsync: jest.fn(async (req) => {
      scheduled.set(req.identifier, req);
      return req.identifier;
    }),
    cancelScheduledNotificationAsync: jest.fn(async (id) => {
      scheduled.delete(id);
    }),
    getAllScheduledNotificationsAsync: jest.fn(async () => [...scheduled.values()]),
    AndroidImportance: { DEFAULT: 3 },
    SchedulableTriggerInputTypes: { DAILY: 'daily' },
  };
});
