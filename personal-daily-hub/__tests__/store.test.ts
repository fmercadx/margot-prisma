import { buildExport } from '../src/lib/exportJson';
import {
  CORE_HABITS,
  DEFAULT_SETTINGS,
  EMPTY_DAY,
  getDay,
  habitsDoneCount,
  habitStreak,
  initialState,
  reducer,
  totalCents,
  WATER_MAX,
  type Action,
  type HubState,
} from '../src/lib/store';

const TODAY = '2026-11-08';
const YESTERDAY = '2026-11-07';

const run = (...actions: Action[]): HubState => actions.reduce(reducer, initialState);
const note = (id: string, text: string) => ({ id, text, createdAt: 1 });

test('each date has its own log, so a new day starts empty', () => {
  const s = run(
    { type: 'addNote', date: YESTERDAY, note: note('a', 'yesterday') },
    { type: 'adjustWater', date: YESTERDAY, delta: 3 },
  );
  expect(getDay(s, YESTERDAY).notes).toHaveLength(1);
  expect(getDay(s, YESTERDAY).water).toBe(3);
  expect(getDay(s, TODAY)).toBe(EMPTY_DAY);
});

test('notes are trimmed, newest first, and blanks are ignored', () => {
  const s = run(
    { type: 'addNote', date: TODAY, note: note('1', '  first  ') },
    { type: 'addNote', date: TODAY, note: note('2', 'second') },
    { type: 'addNote', date: TODAY, note: note('3', '   ') },
  );
  expect(getDay(s, TODAY).notes.map((n) => n.text)).toEqual(['second', 'first']);
  const after = reducer(s, { type: 'deleteNote', date: TODAY, id: '2' });
  expect(getDay(after, TODAY).notes.map((n) => n.id)).toEqual(['1']);
});

test('no-op actions return the same state, so nothing is re-saved', () => {
  const s = run({ type: 'adjustWater', date: TODAY, delta: 1 });
  expect(reducer(s, { type: 'deleteNote', date: TODAY, id: 'missing' })).toBe(s);
  expect(reducer(s, { type: 'toggleHabit', date: TODAY, id: 'not-a-habit' })).toBe(s);
  expect(reducer(s, { type: 'removeHabit', date: TODAY, id: CORE_HABITS[0].id })).toBe(s);
});

test('habits toggle on and off; custom habits can be added and removed', () => {
  let s = run({ type: 'addHabit', habit: { id: 'h1', label: ' Stretch ', core: false } });
  expect(s.habits.map((h) => h.label)).toEqual([...CORE_HABITS.map((h) => h.label), 'Stretch']);

  // A duplicate (any case) is refused.
  expect(reducer(s, { type: 'addHabit', habit: { id: 'h2', label: 'stretch', core: false } })).toBe(s);

  s = reducer(s, { type: 'toggleHabit', date: TODAY, id: 'h1' });
  s = reducer(s, { type: 'toggleHabit', date: TODAY, id: CORE_HABITS[0].id });
  expect(habitsDoneCount(s, getDay(s, TODAY))).toBe(2);
  s = reducer(s, { type: 'toggleHabit', date: TODAY, id: CORE_HABITS[0].id });
  expect(getDay(s, TODAY).habitsDone).toEqual(['h1']);

  s = reducer(s, { type: 'removeHabit', date: TODAY, id: 'h1' });
  expect(s.habits).toHaveLength(CORE_HABITS.length);
  expect(getDay(s, TODAY).habitsDone).toEqual([]);
});

test('removing a habit leaves earlier days alone', () => {
  let s = run(
    { type: 'addHabit', habit: { id: 'h1', label: 'Stretch', core: false } },
    { type: 'toggleHabit', date: YESTERDAY, id: 'h1' },
  );
  s = reducer(s, { type: 'removeHabit', date: TODAY, id: 'h1' });
  expect(getDay(s, YESTERDAY).habitsDone).toEqual(['h1']);
});

test('water and energy are clamped to their ranges', () => {
  let s = run({ type: 'adjustWater', date: TODAY, delta: -1 });
  expect(getDay(s, TODAY).water).toBe(0);
  s = reducer(s, { type: 'adjustWater', date: TODAY, delta: 999 });
  expect(getDay(s, TODAY).water).toBe(WATER_MAX);

  s = reducer(s, { type: 'setEnergy', date: TODAY, value: 0 });
  expect(getDay(s, TODAY).energy).toBe(1);
  s = reducer(s, { type: 'setEnergy', date: TODAY, value: 42 });
  expect(getDay(s, TODAY).energy).toBe(10);
});

test('expenses keep a running total and reject bad amounts', () => {
  const exp = (id: string, cents: number) => ({ id, cents, label: '', category: 'other' as const, createdAt: 1 });
  let s = run(
    { type: 'addExpense', date: TODAY, expense: exp('a', 475) },
    { type: 'addExpense', date: TODAY, expense: exp('b', 3820) },
    { type: 'addExpense', date: TODAY, expense: exp('c', -100) },
    { type: 'addExpense', date: TODAY, expense: exp('d', 1.5) },
  );
  expect(totalCents(getDay(s, TODAY))).toBe(4295);
  s = reducer(s, { type: 'deleteExpense', date: TODAY, id: 'a' });
  expect(totalCents(getDay(s, TODAY))).toBe(3820);
});

test('mergeDays never lets older stored data replace what is in memory', () => {
  const s = run({ type: 'adjustWater', date: TODAY, delta: 4 });
  const merged = reducer(s, {
    type: 'mergeDays',
    days: { [TODAY]: { ...EMPTY_DAY, water: 1 }, [YESTERDAY]: { ...EMPTY_DAY, water: 2 } },
  });
  expect(getDay(merged, TODAY).water).toBe(4);
  expect(getDay(merged, YESTERDAY).water).toBe(2);
});

describe('settings', () => {
  test('are clamped to their ranges, and an unchanged value is a no-op', () => {
    let s = reducer(initialState, { type: 'updateSettings', patch: { waterGoal: 99, reminderHour: 2 } });
    expect(s.settings).toEqual({ ...DEFAULT_SETTINGS, waterGoal: 16, reminderHour: 6 });
    expect(reducer(s, { type: 'updateSettings', patch: { waterGoal: 16 } })).toBe(s);
    s = reducer(s, { type: 'updateSettings', patch: { lockEnabled: true } });
    expect(s.settings.lockEnabled).toBe(true);
  });
});

describe('undo restores', () => {
  test('a note goes back by time, not to the top, and is never duplicated', () => {
    const n = (id: string, t: number) => ({ id, text: id, createdAt: t });
    let s = run(
      { type: 'addNote', date: TODAY, note: n('a', 1) },
      { type: 'addNote', date: TODAY, note: n('c', 3) },
    );
    s = reducer(s, { type: 'restoreNote', date: TODAY, note: n('b', 2) });
    expect(getDay(s, TODAY).notes.map((x) => x.id)).toEqual(['c', 'b', 'a']);
    expect(reducer(s, { type: 'restoreNote', date: TODAY, note: n('b', 2) })).toBe(s);
  });

  test('a habit goes back to its old position, wherever that was', () => {
    let s = run(
      { type: 'addHabit', habit: { id: 'x', label: 'X', core: false } },
      { type: 'addHabit', habit: { id: 'y', label: 'Y', core: false } },
    );
    const x = s.habits.find((h) => h.id === 'x')!;
    s = reducer(s, { type: 'removeHabit', date: TODAY, id: 'x' });
    s = reducer(s, { type: 'restoreHabit', date: TODAY, habit: x, index: 4, wasDone: true });
    expect(s.habits.map((h) => h.id).slice(4)).toEqual(['x', 'y']);
    expect(getDay(s, TODAY).habitsDone).toEqual(['x']);
    const s2 = reducer(s, { type: 'restoreHabit', date: TODAY, habit: { ...x, id: 'z' }, index: 0, wasDone: false });
    expect(s2.habits[0].id).toBe('z');
  });
});

describe('habitStreak', () => {
  const id = 'core-read';
  const withDone = (dates: string[]): HubState =>
    dates.reduce((s, date) => reducer(s, { type: 'toggleHabit', date, id }), initialState);

  test('counts back from today, or from yesterday while today is still open', () => {
    expect(habitStreak(withDone(['2026-11-06', '2026-11-07', TODAY]), id, TODAY, 60)).toBe(3);
    expect(habitStreak(withDone(['2026-11-06', '2026-11-07']), id, TODAY, 60)).toBe(2);
  });

  test('a missed day ends it', () => {
    expect(habitStreak(withDone(['2026-11-05', '2026-11-07', TODAY]), id, TODAY, 60)).toBe(2);
    expect(habitStreak(withDone(['2026-11-06']), id, TODAY, 60)).toBe(0); // yesterday missed
  });

  test('stops at the loaded history', () => {
    const many = Array.from({ length: 10 }, (_, i) => `2026-11-0${i}`).filter((d) => d <= TODAY && d >= '2026-11-01');
    expect(habitStreak(withDone(many), id, TODAY, 5)).toBe(5);
  });
});

describe('buildExport', () => {
  test('leaves out empty days and the lock setting, and sorts by date', () => {
    const { filename, json } = buildExport(
      {
        '2026-11-08': { ...EMPTY_DAY, water: 2 },
        '2026-11-01': { ...EMPTY_DAY, energy: 7 },
        '2026-11-05': EMPTY_DAY,
      },
      [...CORE_HABITS],
      { ...DEFAULT_SETTINGS, lockEnabled: true, dailyBudgetCents: 4000 },
      new Date(2026, 10, 8, 12),
    );
    const file = JSON.parse(json);
    expect(filename).toBe('personal-daily-hub-2026-11-08.json');
    expect(Object.keys(file.days)).toEqual(['2026-11-01', '2026-11-08']);
    expect(file.settings).toEqual({ waterGoal: 8, reminderHour: 20 });
  });
});
