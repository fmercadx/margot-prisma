import { isBudget, MONTHLY_BUDGET_STEPS_CENTS, stepBudget } from '../src/lib/categories';
import { dayAsText } from '../src/lib/dayText';
import { formatCents } from '../src/lib/money';
import { monthToDate } from '../src/lib/monthBudget';
import {
  cancelWaterReminders,
  scheduleWaterReminders,
  WATER_REMINDER_DAYS,
  WATER_REMINDER_HOURS,
  waterReminderTimes,
} from '../src/lib/reminders';
import { searchDays } from '../src/lib/search';
import { sanitizeDay, sanitizeSettings } from '../src/lib/storage';
import {
  CORE_HABITS,
  cleanGratitude,
  EMPTY_DAY,
  getDay,
  GRATITUDE_MAX_LENGTH,
  hasAnyData,
  initialState,
  mergeBackup,
  reducer,
  type DayLog,
  type Expense,
} from '../src/lib/store';

const N = jest.requireMock('expo-notifications');

const spend = (cents: number, id = `e${cents}`): Expense => ({ id, cents, label: '', category: 'other', createdAt: 1 });
const withSpend = (...cents: number[]): DayLog => ({ ...EMPTY_DAY, expenses: cents.map((c, i) => spend(c, `e${i}`)) });

describe('monthly budget', () => {
  test('the month so far: from the 1st to today, nothing from last month or later this month', () => {
    const days = {
      '2026-10-31': withSpend(99_999),
      '2026-11-01': withSpend(1000),
      '2026-11-18': withSpend(1500, 500),
      '2026-11-19': withSpend(99_999), // tomorrow
    };
    // November has 30 days; on the 18th, 13 are left counting today.
    expect(monthToDate(days, '2026-11-18', 20_000)).toEqual({
      spentCents: 3000,
      daysLeft: 13,
      perDayCents: Math.floor(17_000 / 13),
      overCents: 0,
    });
  });

  test('over budget, nothing is left per day; on the last day it is all for today', () => {
    expect(monthToDate({ '2026-11-02': withSpend(25_000) }, '2026-11-18', 20_000)).toMatchObject({
      perDayCents: 0,
      overCents: 5000,
    });
    expect(monthToDate({}, '2026-02-28', 10_000)).toMatchObject({ daysLeft: 1, perDayCents: 10_000 });
    expect(monthToDate({}, '2028-02-28', 10_000).daysLeft).toBe(2); // a leap year
  });

  test('steps from $100 to $10,000; off below the first', () => {
    expect(stepBudget(null, 1, MONTHLY_BUDGET_STEPS_CENTS)).toBe(10_000);
    expect(stepBudget(10_000, -1, MONTHLY_BUDGET_STEPS_CENTS)).toBeNull();
    expect(stepBudget(1_000_000, 1, MONTHLY_BUDGET_STEPS_CENTS)).toBe(1_000_000);
    expect(stepBudget(60_000, 1, MONTHLY_BUDGET_STEPS_CENTS)).toBe(75_000);
    expect(isBudget(5000, MONTHLY_BUDGET_STEPS_CENTS)).toBe(false);
    expect(isBudget(250_000, MONTHLY_BUDGET_STEPS_CENTS)).toBe(true);
  });

  test('the setting is checked on the way in and on the way back from storage', () => {
    const s = reducer(initialState, { type: 'updateSettings', patch: { monthlyBudgetCents: 200_000 } });
    expect(s.settings.monthlyBudgetCents).toBe(200_000);
    expect(reducer(s, { type: 'updateSettings', patch: { monthlyBudgetCents: 7 } }).settings.monthlyBudgetCents).toBeNull();
    expect(sanitizeSettings({ monthlyBudgetCents: 200_000 }).monthlyBudgetCents).toBe(200_000);
    expect(sanitizeSettings({ monthlyBudgetCents: 99_999_999 }).monthlyBudgetCents).toBeNull();
    expect(sanitizeSettings({}).monthlyBudgetCents).toBeNull();
  });
});

describe('three good things', () => {
  const D = '2026-11-18';

  test('one line each, trimmed and capped, empty ones dropped, three at most', () => {
    expect(cleanGratitude(['  Sun  on the\nbalcony ', '', 7, 'Call with Mum', 'Good coffee', 'A fourth'])).toEqual([
      'Sun on the balcony',
      'Call with Mum',
      'Good coffee',
    ]);
    expect(cleanGratitude(['x'.repeat(500)])[0]).toHaveLength(GRATITUDE_MAX_LENGTH);
  });

  test('saved to the day; saving the same again is a no-op; clearing them all empties it', () => {
    let s = reducer(initialState, { type: 'setGratitude', date: D, items: ['Sun', '', 'Coffee'] });
    expect(getDay(s, D).gratitude).toEqual(['Sun', 'Coffee']);
    expect(hasAnyData(getDay(s, D))).toBe(true);
    expect(reducer(s, { type: 'setGratitude', date: D, items: [' Sun ', 'Coffee', ''] })).toBe(s);
    s = reducer(s, { type: 'setGratitude', date: D, items: ['', '', ''] });
    expect(getDay(s, D).gratitude).toEqual([]);
  });

  test('stored lists are checked like typed ones', () => {
    expect(sanitizeDay({ gratitude: ['a', 5, ' b ', 'c', 'd'] }).gratitude).toEqual(['a', 'b', 'c']);
    expect(sanitizeDay({ gratitude: 'not a list' }).gratitude).toEqual([]);
    expect(sanitizeDay({}).gratitude).toEqual([]);
  });

  test('restoring keeps the phone’s list, and fills an empty one from the backup', () => {
    const mine = reducer(initialState, { type: 'setGratitude', date: D, items: ['Mine'] });
    expect(getDay(mergeBackup(mine, [], { [D]: { ...EMPTY_DAY, gratitude: ['Theirs'] } }).state, D).gratitude).toEqual(['Mine']);
    const empty = reducer(initialState, { type: 'adjustWater', date: D, delta: 1 });
    expect(getDay(mergeBackup(empty, [], { [D]: { ...EMPTY_DAY, gratitude: ['Theirs'] } }).state, D).gratitude).toEqual([
      'Theirs',
    ]);
  });

  test('in a shared day, and found by search', () => {
    const day: DayLog = { ...EMPTY_DAY, gratitude: ['Sunny walk', 'Soup'] };
    expect(dayAsText(D, day, [...CORE_HABITS], 8, formatCents).split('\n')).toEqual([
      'Wednesday, November 18, 2026',
      'Three good things',
      '  1. Sunny walk',
      '  2. Soup',
    ]);
    const { hits } = searchDays({ [D]: day }, 'sunny');
    expect(hits).toEqual([{ date: D, kind: 'good', id: `good-${D}-0`, text: 'Sunny walk', time: null, start: 0, length: 5 }]);
  });
});

describe('water reminders', () => {
  const at = (h: number, m = 0) => new Date(2026, 10, 18, h, m);
  const scheduled = () => [...N.__scheduled.values()].filter((r: { identifier: string }) => r.identifier.startsWith('pdh-water-'));

  beforeEach(async () => {
    N.__scheduled.clear();
    jest.clearAllMocks();
  });

  test('every two hours from 10 to 6, for a week; only what is still ahead today', () => {
    expect(waterReminderTimes(at(8), false)).toHaveLength(WATER_REMINDER_HOURS.length * WATER_REMINDER_DAYS);
    const afternoon = waterReminderTimes(at(13), false);
    expect(afternoon.slice(0, 3).map((d) => d.getHours())).toEqual([14, 16, 18]);
    expect(afternoon[3]).toEqual(new Date(2026, 10, 19, 10));
  });

  test('once today’s goal is reached, today’s stop and tomorrow’s still come', () => {
    const times = waterReminderTimes(at(9), true);
    expect(times[0]).toEqual(new Date(2026, 10, 19, 10));
    expect(times).toHaveLength(WATER_REMINDER_HOURS.length * (WATER_REMINDER_DAYS - 1));
  });

  test('scheduling replaces what was there, with fixed wording that says nothing about the day', async () => {
    expect(await scheduleWaterReminders(at(13), false)).toBe('enabled');
    const first = scheduled().length;
    expect(first).toBe(3 + WATER_REMINDER_HOURS.length * (WATER_REMINDER_DAYS - 1));
    expect(await scheduleWaterReminders(at(13), true)).toBe('enabled');
    expect(scheduled()).toHaveLength(first - 3);
    const req = scheduled()[0];
    expect(req.content).toEqual({ title: 'Time for a glass of water', body: 'A quick sip keeps the day going.' });
    expect(req.trigger).toMatchObject({ type: 'date', date: new Date(2026, 10, 19, 10).getTime() });
    await cancelWaterReminders();
    expect(scheduled()).toHaveLength(0);
  });

  test('cancelling leaves the daily reminder and the focus timer alone', async () => {
    N.__scheduled.set('pdh-daily-reminder', { identifier: 'pdh-daily-reminder' });
    N.__scheduled.set('pdh-focus-end', { identifier: 'pdh-focus-end' });
    await scheduleWaterReminders(at(13), false);
    await cancelWaterReminders();
    expect([...N.__scheduled.keys()].sort()).toEqual(['pdh-daily-reminder', 'pdh-focus-end']);
  });

  test('with notifications refused, nothing is scheduled', async () => {
    N.getPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: false, status: 'denied' });
    expect(await scheduleWaterReminders(at(13), false)).toBe('denied');
    expect(scheduled()).toHaveLength(0);
  });

  test('the setting is a plain yes or no', () => {
    expect(reducer(initialState, { type: 'updateSettings', patch: { waterReminders: true } }).settings.waterReminders).toBe(true);
    expect(sanitizeSettings({ waterReminders: 'yes' }).waterReminders).toBe(false);
  });
});
