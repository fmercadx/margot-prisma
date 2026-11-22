import { CATEGORY_BUDGET_STEPS_CENTS, normalizeCategoryBudgets, stepBudget } from '../src/lib/categories';
import { budgetCrossing, categoryBudgetUse, categorySpent } from '../src/lib/monthBudget';
import { cancelWindDown, minutesLabel, scheduleWindDown } from '../src/lib/reminders';
import { sanitizeSettings } from '../src/lib/storage';
import {
  CORE_HABITS,
  DEFAULT_SETTINGS,
  EMPTY_DAY,
  initialState,
  reducer,
  WIND_DOWN_CHOICES,
  WIND_DOWN_DEFAULT,
  type DayLog,
  type Expense,
  type HubState,
} from '../src/lib/store';
import { shortFocus } from '../src/components/WeekGoals';
import { weekReview } from '../src/lib/weekReview';

const N = jest.requireMock('expo-notifications');
const expense = (id: string, cents: number, category: Expense['category']): Expense => ({
  id,
  cents,
  label: '',
  category,
  createdAt: 1,
});
const day = (v: Partial<DayLog>): DayLog => ({ ...EMPTY_DAY, ...v });

describe('budgets by category', () => {
  test('only known categories with a real step are kept, in category order', () => {
    expect(
      normalizeCategoryBudgets({ fun: 5000, food: 30000, pets: 1000, bills: 7, shopping: null, other: '2500' }),
    ).toEqual({
      food: 30000,
      fun: 5000,
    });
    expect(Object.keys(normalizeCategoryBudgets({ fun: 5000, food: 30000 }))).toEqual(['food', 'fun']);
    for (const bad of [null, 'x', [2500], 7]) expect(normalizeCategoryBudgets(bad)).toEqual({});
  });

  test('settings: stepping a category up and down to off; an unchanged set is a no-op', () => {
    const up = stepBudget(null, 1, CATEGORY_BUDGET_STEPS_CENTS)!;
    expect(up).toBe(2500);
    let s = reducer(initialState, { type: 'updateSettings', patch: { categoryBudgets: { food: up } } });
    expect(s.settings.categoryBudgets).toEqual({ food: 2500 });
    expect(reducer(s, { type: 'updateSettings', patch: { categoryBudgets: { food: 2500 } } })).toBe(s);
    s = reducer(s, { type: 'updateSettings', patch: { categoryBudgets: { food: null as never } } });
    expect(s.settings.categoryBudgets).toEqual({});
    expect(stepBudget(300000, 1, CATEGORY_BUDGET_STEPS_CENTS)).toBe(300000);
  });

  test('spending is summed for one category over one calendar month', () => {
    const days = {
      '2026-11-01': day({ expenses: [expense('a', 1000, 'food'), expense('b', 500, 'fun')] }),
      '2026-11-21': day({ expenses: [expense('c', 2500, 'food')] }),
      '2026-10-31': day({ expenses: [expense('d', 9999, 'food')] }), // last month
    };
    expect(categorySpent(days, '2026-11', 'food')).toBe(3500);
    expect(categoryBudgetUse(days, '2026-11', { fun: 2500, food: 5000 })).toEqual([
      { category: 'food', spentCents: 3500, budgetCents: 5000 },
      { category: 'fun', spentCents: 500, budgetCents: 2500 },
    ]);
    expect(categoryBudgetUse(days, '2026-11', {})).toEqual([]);
  });

  test('a message is due only when spending crosses 80%, or the limit', () => {
    const b = 10000;
    expect(budgetCrossing(7000, 7900, b)).toBeNull();
    expect(budgetCrossing(7000, 8000, b)).toBe('near');
    expect(budgetCrossing(8000, 9000, b)).toBeNull(); // already close
    expect(budgetCrossing(9000, 10000, b)).toBeNull(); // right at the limit is not over
    expect(budgetCrossing(9000, 10001, b)).toBe('over');
    expect(budgetCrossing(1000, 12000, b)).toBe('over'); // straight past both
    expect(budgetCrossing(11000, 12000, b)).toBeNull(); // already over
  });
});

describe('wind-down reminder', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await cancelWindDown();
  });

  test('times run 8:30 to 11:30 PM in half hours, starting at 10', () => {
    expect(WIND_DOWN_CHOICES.map(minutesLabel)).toEqual([
      '8:30 PM',
      '9:00 PM',
      '9:30 PM',
      '10:00 PM',
      '10:30 PM',
      '11:00 PM',
      '11:30 PM',
    ]);
    expect(minutesLabel(WIND_DOWN_DEFAULT)).toBe('10:00 PM');
    expect(minutesLabel(0)).toBe('12:00 AM');
  });

  test('one daily notification with fixed wording; moving it replaces it; cancelling removes it', async () => {
    expect(await scheduleWindDown(1320)).toBe('enabled');
    expect(await scheduleWindDown(1350)).toBe('enabled');
    const ours = [...N.__scheduled.values()].filter((r: { identifier: string }) => r.identifier === 'pdh-wind-down');
    expect(ours).toHaveLength(1);
    expect(ours[0].trigger).toMatchObject({ type: 'daily', hour: 22, minute: 30 });
    expect(ours[0].content).toEqual({
      title: 'Time to wind down',
      body: 'Screens down, lights low. A good night starts now.',
    });
    await cancelWindDown();
    expect(N.__scheduled.has('pdh-wind-down')).toBe(false);
  });

  test('a refused permission schedules nothing', async () => {
    N.getPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: false, status: 'denied' });
    expect(await scheduleWindDown(1320)).toBe('denied');
    expect(N.__scheduled.has('pdh-wind-down')).toBe(false);
  });

  test('settings take only the offered times; null turns it off', () => {
    let s = reducer(initialState, { type: 'updateSettings', patch: { windDownAt: 1290 } });
    expect(s.settings.windDownAt).toBe(1290);
    expect(reducer(s, { type: 'updateSettings', patch: { windDownAt: 1295 } })).toBe(s);
    s = reducer(s, { type: 'updateSettings', patch: { windDownAt: null } });
    expect(s.settings.windDownAt).toBeNull();
  });
});

describe('settings stored by 1.12', () => {
  test('are checked when read back', () => {
    expect(sanitizeSettings({}).windDownAt).toBeNull();
    expect(sanitizeSettings({}).categoryBudgets).toEqual({});
    expect(sanitizeSettings({}).reviewedWeek).toBeNull();
    const s = sanitizeSettings({
      windDownAt: 1350,
      categoryBudgets: { food: 30000, x: 1 },
      reviewedWeek: '2026-11-12',
    });
    expect(s).toMatchObject({ windDownAt: 1350, categoryBudgets: { food: 30000 }, reviewedWeek: '2026-11-08' });
    for (const bad of [1351, -1, '1320', 99999]) expect(sanitizeSettings({ windDownAt: bad }).windDownAt).toBeNull();
    expect(sanitizeSettings({ reviewedWeek: 'last week' }).reviewedWeek).toBeNull();
    expect(DEFAULT_SETTINGS).toMatchObject({ windDownAt: null, categoryBudgets: {}, reviewedWeek: null });
  });

  test('putting a review away is filed under that week’s Sunday', () => {
    const s = reducer(initialState, { type: 'updateSettings', patch: { reviewedWeek: '2026-11-11' } });
    expect(s.settings.reviewedWeek).toBe('2026-11-08');
    expect(reducer(s, { type: 'updateSettings', patch: { reviewedWeek: '2026-11-08' } })).toBe(s);
  });
});

describe('week in review', () => {
  const WEEK = '2026-11-08'; // Sunday; the week runs to Saturday the 14th
  const withWeek = (days: Record<string, Partial<DayLog>>, extra: Partial<HubState> = {}): HubState => ({
    ...initialState,
    ...extra,
    days: Object.fromEntries(Object.entries(days).map(([d, v]) => [d, day(v)])),
  });

  test('nothing logged and no goals: nothing to review', () => {
    expect(weekReview(initialState, WEEK)).toBeNull();
    // A day just outside the week doesn't count.
    expect(weekReview(withWeek({ '2026-11-15': { water: 3 } }), WEEK)).toBeNull();
  });

  test('goals, habits, the steadiest habit, mood, sleep, focus and spending', () => {
    const s = withWeek(
      {
        '2026-11-08': { habitsDone: ['core-read', 'core-move'], mood: 4, sleep: 7, focusMinutes: 25 },
        '2026-11-09': { habitsDone: ['core-read'], mood: 5, sleep: 8, expenses: [expense('a', 1250, 'food')] },
        '2026-11-10': { habitsDone: ['core-read', 'core-plan'], focusMinutes: 50 },
        '2026-11-11': { habitsDone: ['core-read'] },
        '2026-11-12': { habitsSkipped: ['core-read'], mood: 3 },
        '2026-11-13': { habitsDone: ['core-read'], expenses: [expense('b', 750, 'fun')] },
      },
      {
        goals: [
          { id: 'g1', text: 'Book the dentist', week: WEEK, createdAt: 1, doneAt: 2 },
          { id: 'g2', text: 'Clear the inbox', week: WEEK, createdAt: 2 },
          { id: 'g3', text: 'Another week', week: '2026-11-15', createdAt: 3 },
        ],
      },
    );
    const r = weekReview(s, WEEK)!;
    expect(r).toMatchObject({
      week: WEEK,
      daysLogged: 6,
      goals: { done: 1, total: 2 },
      avgMood: 4,
      avgSleep: 7.5,
      focusMinutes: 75,
      spentCents: 2000,
    });
    // Read: 5 of its 6 due days (the skipped day doesn't count) — the steadiest.
    expect(r.steadiest).toEqual({ label: 'Read 20 pages', done: 5, due: 6 });
    // 4 habits × 7 days, less the skipped one = 27 due; 7 done.
    expect(r.habitRate).toBeCloseTo(7 / 27);
  });

  test('a habit due on fewer than three days can’t be the steadiest', () => {
    const s = withWeek(
      { '2026-11-09': { habitsDone: ['core-move'] }, '2026-11-11': { habitsDone: ['core-move'] } },
      { habits: [{ ...CORE_HABITS[0], days: [1, 3] }, ...CORE_HABITS.slice(1)] },
    );
    expect(weekReview(s, WEEK)!.steadiest).toBeNull();
  });

  test('focus is written short enough to fit its tile', () => {
    expect([45, 60, 75, 600].map(shortFocus)).toEqual(['45m', '1h', '1h 15m', '10h']);
  });

  test('goals alone are enough for a review', () => {
    const s = withWeek({}, { goals: [{ id: 'g1', text: 'Book the dentist', week: WEEK, createdAt: 1 }] });
    expect(weekReview(s, WEEK)).toMatchObject({ daysLogged: 0, goals: { done: 0, total: 1 } });
  });
});
