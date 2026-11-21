import { dayAsText } from '../src/lib/dayText';
import { formatCents } from '../src/lib/money';
import { cancelFocusEnd, scheduleFocusEnd } from '../src/lib/reminders';
import { habitsForStorage, sanitizeDay, sanitizeFocusTimer, sanitizeHabits, sanitizeSettings } from '../src/lib/storage';
import {
  CORE_HABITS,
  DEFAULT_SETTINGS,
  EMPTY_DAY,
  FOCUS_MINUTES_MAX,
  focusLabel,
  focusMinutesDone,
  getDay,
  habitStreak,
  HOME_CARDS,
  initialState,
  isDue,
  mergeBackup,
  normalizeHomeHidden,
  normalizeHomeOrder,
  reducer,
  type Action,
  type DayLog,
  type HubState,
} from '../src/lib/store';
import { weekSummary } from '../src/lib/summary';
import { glassesExpected, paceWords } from '../src/lib/waterPace';

const N = jest.requireMock('expo-notifications');

const run = (state: HubState, ...actions: Action[]): HubState => actions.reduce(reducer, state);
const ids = (s: HubState) => s.habits.map((h) => h.id);
const MIN = 60_000;

describe('skipping a habit for a day', () => {
  const D = '2026-11-18';

  test('skip sets it aside and unticks it; ticking takes it back; skipping again undoes it', () => {
    let s = run(initialState, { type: 'toggleHabit', date: D, id: 'core-read' }, { type: 'skipHabit', date: D, id: 'core-read' });
    expect(getDay(s, D)).toMatchObject({ habitsDone: [], habitsSkipped: ['core-read'] });
    s = reducer(s, { type: 'toggleHabit', date: D, id: 'core-read' });
    expect(getDay(s, D)).toMatchObject({ habitsDone: ['core-read'], habitsSkipped: [] });
    s = run(s, { type: 'skipHabit', date: D, id: 'core-read' }, { type: 'skipHabit', date: D, id: 'core-read' });
    expect(getDay(s, D)).toMatchObject({ habitsDone: [], habitsSkipped: [] });
  });

  test('an unknown habit can’t be skipped; removing a habit clears its skip today', () => {
    expect(reducer(initialState, { type: 'skipHabit', date: D, id: 'nope' })).toBe(initialState);
    let s = run(
      initialState,
      { type: 'addHabit', habit: { id: 'c', label: 'Stretch', core: false } },
      { type: 'skipHabit', date: D, id: 'c' },
      { type: 'removeHabit', date: D, id: 'c' },
    );
    expect(getDay(s, D).habitsSkipped).toEqual([]);
    // Undo puts the skip back.
    s = reducer(s, {
      type: 'restoreHabit',
      date: D,
      habit: { id: 'c', label: 'Stretch', core: false },
      index: 4,
      wasDone: false,
      wasSkipped: true,
    });
    expect(getDay(s, D).habitsSkipped).toEqual(['c']);
  });

  test('a skipped day neither counts nor breaks the streak', () => {
    // Mon 16 done, Tue 17 skipped, Wed 18 done.
    const s = run(
      initialState,
      { type: 'toggleHabit', date: '2026-11-16', id: 'core-move' },
      { type: 'skipHabit', date: '2026-11-17', id: 'core-move' },
      { type: 'toggleHabit', date: '2026-11-18', id: 'core-move' },
    );
    expect(habitStreak(s, 'core-move', '2026-11-18', 60)).toBe(2);
    // Skipped today: the streak up to yesterday stands.
    const t = run(s, { type: 'skipHabit', date: '2026-11-19', id: 'core-move' });
    expect(habitStreak(t, 'core-move', '2026-11-19', 60)).toBe(2);
    // A plain miss still breaks it.
    expect(habitStreak(s, 'core-move', '2026-11-20', 60)).toBe(0);
  });

  test('isDue: meant for the day and not set aside', () => {
    const h = { id: 'h', days: [3] }; // Wednesdays
    expect(isDue(h, '2026-11-18', null)).toBe(true);
    expect(isDue(h, '2026-11-19', null)).toBe(false);
    expect(isDue(h, '2026-11-18', { habitsSkipped: ['h'] })).toBe(false);
  });

  test('summaries leave skipped habits out of what was due', () => {
    const log: DayLog = { ...EMPTY_DAY, habitsDone: ['core-move'], habitsSkipped: ['core-read', 'core-plan'] };
    expect(weekSummary([{ date: D, log }], [...CORE_HABITS]).habitRate).toBe(1 / 2);
  });

  test('a shared day lists what was skipped, and the focus time', () => {
    const log: DayLog = { ...EMPTY_DAY, habitsDone: ['core-move'], habitsSkipped: ['core-read'], focusMinutes: 75 };
    expect(dayAsText(D, log, [...CORE_HABITS], 8, formatCents).split('\n')).toEqual([
      'Wednesday, November 18, 2026',
      'Focused for 1 h 15 min',
      'Habits 1/3: Move for 30 minutes',
      'Skipped: Read 20 pages',
    ]);
  });

  test('stored: skipped ids are checked, and a habit both done and skipped counts as done', () => {
    const day = sanitizeDay({ habitsDone: ['a'], habitsSkipped: ['a', 'b', 'b', 7, ''] });
    expect(day.habitsDone).toEqual(['a']);
    expect(day.habitsSkipped).toEqual(['b']);
    expect(sanitizeDay({ habitsSkipped: 'b' }).habitsSkipped).toEqual([]);
  });

  test('restoring a backup combines skips, done wins, and takes the larger focus time', () => {
    const state = run(initialState, { type: 'skipHabit', date: D, id: 'core-move' }, { type: 'toggleHabit', date: D, id: 'core-read' });
    const theirs: DayLog = { ...EMPTY_DAY, habitsDone: ['core-move'], habitsSkipped: ['core-plan'], focusMinutes: 50 };
    const { state: merged, stats } = mergeBackup(state, [], { [D]: theirs });
    expect(getDay(merged, D)).toMatchObject({
      habitsDone: ['core-read', 'core-move'],
      habitsSkipped: ['core-plan'],
      focusMinutes: 50,
    });
    expect(stats.daysMerged).toBe(1);
    // A second restore changes nothing.
    expect(mergeBackup(merged, [], { [D]: theirs }).state).toBe(merged);
  });
});

describe('reordering habits', () => {
  const withCustom = run(
    initialState,
    { type: 'addHabit', habit: { id: 'c1', label: 'Stretch', core: false } },
    { type: 'addHabit', habit: { id: 'c2', label: 'Journal', core: false } },
  );

  test('a habit moves before or after another, core or custom', () => {
    let s = reducer(withCustom, { type: 'moveHabit', id: 'c2', nextTo: 'core-move', where: 'before' });
    expect(ids(s)).toEqual(['c2', 'core-move', 'core-read', 'core-mindful', 'core-plan', 'c1']);
    s = reducer(s, { type: 'moveHabit', id: 'core-move', nextTo: 'c1', where: 'after' });
    expect(ids(s)).toEqual(['c2', 'core-read', 'core-mindful', 'core-plan', 'c1', 'core-move']);
  });

  test('a move that changes nothing, or names an unknown habit, is a no-op', () => {
    expect(reducer(withCustom, { type: 'moveHabit', id: 'core-read', nextTo: 'core-move', where: 'after' })).toBe(withCustom);
    expect(reducer(withCustom, { type: 'moveHabit', id: 'x', nextTo: 'core-move', where: 'after' })).toBe(withCustom);
    expect(reducer(withCustom, { type: 'moveHabit', id: 'c1', nextTo: 'x', where: 'after' })).toBe(withCustom);
    expect(reducer(withCustom, { type: 'moveHabit', id: 'c1', nextTo: 'c1', where: 'after' })).toBe(withCustom);
  });

  test('the order survives storage, schedules and all', () => {
    let s = reducer(withCustom, { type: 'moveHabit', id: 'c1', nextTo: 'core-move', where: 'before' });
    s = reducer(s, { type: 'setHabitDays', id: 'core-plan', days: [0] });
    const back = sanitizeHabits(JSON.parse(JSON.stringify(habitsForStorage(s.habits))));
    expect(back).toEqual(s.habits);
  });

  test('habits saved before 1.8 (core four first, only scheduled ones stored) load as they were', () => {
    const legacy = [
      { id: 'core-read', core: true, days: [1, 2] },
      { id: 'c1', label: 'Stretch', core: false },
    ];
    expect(sanitizeHabits(legacy).map((h) => h.id)).toEqual(['core-move', 'core-read', 'core-mindful', 'core-plan', 'c1']);
    expect(sanitizeHabits(legacy)[1].days).toEqual([1, 2]);
  });

  test('a stored order can’t drop, duplicate or invent a habit', () => {
    const stored = [
      { id: 'c1', label: 'Stretch', core: false },
      { id: 'core-plan', core: true },
      { id: 'core-plan', core: true },
      { id: 'core-move', core: true },
      { id: 'fake-core', core: true },
      { id: 'c1', label: 'Again', core: false },
      { id: 'core-read', core: true },
      { id: 'core-mindful', core: true, label: 'Renamed' },
    ];
    const habits = sanitizeHabits(stored);
    expect(habits.map((h) => h.id)).toEqual(['c1', 'core-plan', 'core-move', 'core-read', 'core-mindful']);
    expect(habits.find((h) => h.id === 'core-mindful')!.label).toBe('Meditate for 10 minutes');
  });

  test('undo puts a removed habit back where it was, even above the core four', () => {
    const s = reducer(withCustom, { type: 'moveHabit', id: 'c1', nextTo: 'core-move', where: 'before' });
    const c1 = s.habits[0];
    const removed = reducer(s, { type: 'removeHabit', date: '2026-11-18', id: 'c1' });
    const back = reducer(removed, { type: 'restoreHabit', date: '2026-11-18', habit: c1, index: 0, wasDone: false });
    expect(ids(back)).toEqual(ids(s));
  });
});

describe('the focus timer', () => {
  const D = '2026-11-18';
  const T0 = new Date(2026, 10, 18, 9, 0).getTime();
  const started = reducer(initialState, { type: 'startFocus', date: D, now: T0, minutes: 25 });

  test('a session starts once, at a length on the list', () => {
    expect(started.focusTimer).toEqual({ date: D, startedAt: T0, endsAt: T0 + 25 * MIN });
    expect(reducer(started, { type: 'startFocus', date: D, now: T0 + MIN, minutes: 25 })).toBe(started);
    expect(reducer(initialState, { type: 'startFocus', date: D, now: T0, minutes: 7 })).toBe(initialState);
  });

  test('finishing adds its whole length to the day it started on, never more', () => {
    const s = reducer(started, { type: 'endFocus', now: T0 + 3 * 60 * MIN });
    expect(s.focusTimer).toBeNull();
    expect(getDay(s, D).focusMinutes).toBe(25);
  });

  test('stopping early keeps the whole minutes done; under a minute adds nothing', () => {
    expect(getDay(reducer(started, { type: 'endFocus', now: T0 + 12.9 * MIN }), D).focusMinutes).toBe(12);
    const quick = reducer(started, { type: 'endFocus', now: T0 + 30_000 });
    expect(quick.focusTimer).toBeNull();
    expect(quick.days[D]).toBeUndefined();
  });

  test('cancelling adds nothing; with no session, ending and cancelling do nothing', () => {
    const s = reducer(started, { type: 'cancelFocus' });
    expect(s.focusTimer).toBeNull();
    expect(s.days).toEqual({});
    expect(reducer(initialState, { type: 'endFocus', now: T0 })).toBe(initialState);
    expect(reducer(initialState, { type: 'cancelFocus' })).toBe(initialState);
  });

  test('a day holds no more focus than it has minutes', () => {
    const full: HubState = { ...started, days: { [D]: { ...EMPTY_DAY, focusMinutes: FOCUS_MINUTES_MAX - 5 } } };
    expect(getDay(reducer(full, { type: 'endFocus', now: T0 + 25 * MIN }), D).focusMinutes).toBe(FOCUS_MINUTES_MAX);
  });

  test('minutes done and the words for them', () => {
    const t = started.focusTimer!;
    expect(focusMinutesDone(t, T0 - MIN)).toBe(0);
    expect(focusMinutesDone(t, T0 + 10 * MIN)).toBe(10);
    expect(focusMinutesDone(t, T0 + 99 * MIN)).toBe(25);
    expect([45, 60, 75, 125].map(focusLabel)).toEqual(['45 min', '1 h', '1 h 15 min', '2 h 5 min']);
  });

  test('a stored session is checked before it is trusted', () => {
    expect(sanitizeFocusTimer({ date: D, startedAt: T0, endsAt: T0 + 25 * MIN })).toEqual({
      date: D,
      startedAt: T0,
      endsAt: T0 + 25 * MIN,
    });
    for (const bad of [
      null,
      { date: 'tomorrow', startedAt: T0, endsAt: T0 + MIN },
      { date: D, startedAt: T0, endsAt: T0 },
      { date: D, startedAt: T0, endsAt: T0 + 61 * MIN },
      { date: D, startedAt: 'x', endsAt: T0 + MIN },
    ]) {
      expect(sanitizeFocusTimer(bad)).toBeNull();
    }
  });

  test('stored focus minutes are clamped', () => {
    expect(sanitizeDay({ focusMinutes: 99_999 }).focusMinutes).toBe(FOCUS_MINUTES_MAX);
    expect(sanitizeDay({ focusMinutes: -4 }).focusMinutes).toBe(0);
    expect(sanitizeDay({ focusMinutes: '30' }).focusMinutes).toBe(0);
  });

  test('the end is a local notification that says nothing about the focus itself', async () => {
    N.__scheduled.clear();
    expect(await scheduleFocusEnd(T0 + 25 * MIN, 25)).toBe('enabled');
    const req = N.__scheduled.get('pdh-focus-end');
    expect(req.trigger).toMatchObject({ type: 'date', date: T0 + 25 * MIN });
    expect(req.content).toEqual({ title: 'Focus session done', body: '25 minutes of focus. Time for a short break.' });
    await cancelFocusEnd();
    expect(N.__scheduled.has('pdh-focus-end')).toBe(false);
  });

  test('with notifications refused, nothing is scheduled', async () => {
    N.__scheduled.clear();
    N.getPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: false, status: 'denied' });
    expect(await scheduleFocusEnd(T0 + 25 * MIN, 25)).toBe('denied');
    expect(N.__scheduled.size).toBe(0);
  });
});

describe('settings for 1.8', () => {
  test('the test Premium unlock is a plain yes or no, off unless stored as exactly true', () => {
    const s = reducer(initialState, { type: 'updateSettings', patch: { mockPremium: true } });
    expect(s.settings.mockPremium).toBe(true);
    expect(reducer(s, { type: 'updateSettings', patch: { mockPremium: true } })).toBe(s);
    expect(reducer(s, { type: 'updateSettings', patch: { mockPremium: false } }).settings.mockPremium).toBe(false);
    expect(sanitizeSettings({ mockPremium: true }).mockPremium).toBe(true);
    expect(sanitizeSettings({ mockPremium: 'yes' }).mockPremium).toBe(false);
    expect(sanitizeSettings({}).mockPremium).toBe(false);
  });

  test('focus length is one of the choices', () => {
    expect(reducer(initialState, { type: 'updateSettings', patch: { focusLength: 45 } }).settings.focusLength).toBe(45);
    expect(reducer(initialState, { type: 'updateSettings', patch: { focusLength: 44 } })).toBe(initialState);
    expect(sanitizeSettings({ focusLength: 999 }).focusLength).toBe(25);
  });

  test('the home order always holds every card once', () => {
    expect(normalizeHomeOrder(['history', 'history', 'nope', 'focus'])).toEqual([
      'history',
      'focus',
      'notes',
      'habits',
      'wellbeing',
      'expenses',
      'journal',
      'onThisDay',
      'countdowns',
      'insights',
    ]);
    // A card missing from a saved order lands after the card it follows by default.
    const saved = HOME_CARDS.filter((c) => c !== 'journal').reverse();
    const order = normalizeHomeOrder(saved);
    expect(order.indexOf('journal')).toBe(order.indexOf('expenses') + 1);
    expect(order).toHaveLength(HOME_CARDS.length);
  });

  test('hidden cards are known ones, once, in default order', () => {
    expect(normalizeHomeHidden(['history', 'x', 'focus', 'focus'])).toEqual(['focus', 'history']);
  });

  test('arranging goes through the same checks, and an unchanged arrangement is a no-op', () => {
    const s = reducer(initialState, {
      type: 'updateSettings',
      patch: {
        homeOrder: ['journal', ...HOME_CARDS.filter((c) => c !== 'journal'), 'bogus' as never, 'journal'],
        homeHidden: ['insights', 'insights'],
      },
    });
    expect(s.settings.homeOrder[0]).toBe('journal');
    expect(s.settings.homeOrder).toHaveLength(HOME_CARDS.length);
    expect(s.settings.homeHidden).toEqual(['insights']);
    expect(reducer(s, { type: 'updateSettings', patch: { homeHidden: ['insights'] } })).toBe(s);
  });

  test('stored arrangements are checked; missing ones are the default', () => {
    expect(sanitizeSettings({})).toEqual(DEFAULT_SETTINGS);
    const s = sanitizeSettings({ homeOrder: 'focus', homeHidden: [1, 'notes'] });
    expect(s.homeOrder).toEqual([...HOME_CARDS]);
    expect(s.homeHidden).toEqual(['notes']);
  });
});

describe('water pace', () => {
  const at = (h: number, m = 0) => new Date(2026, 10, 18, h, m);

  test('nothing is expected before 8 AM, all of it by 8 PM, evenly between', () => {
    expect(glassesExpected(8, at(7, 59))).toBe(0);
    expect(glassesExpected(8, at(14))).toBe(4);
    expect(glassesExpected(8, at(20))).toBe(8);
    expect(glassesExpected(8, at(23))).toBe(8);
  });

  test('words only when they mean something', () => {
    expect(paceWords(0, 8, at(8, 30))).toBeNull(); // too early to say
    expect(paceWords(2, 8, at(14))).toBe('2 behind pace');
    expect(paceWords(4, 8, at(14))).toBe('on pace');
    expect(paceWords(8, 8, at(9))).toBeNull(); // goal met
  });
});
