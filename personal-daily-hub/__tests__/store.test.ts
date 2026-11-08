import {
  CORE_HABITS,
  EMPTY_DAY,
  getDay,
  habitsDoneCount,
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
  const exp = (id: string, cents: number) => ({ id, cents, label: '', createdAt: 1 });
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
