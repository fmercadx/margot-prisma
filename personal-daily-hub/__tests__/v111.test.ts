import { addDays, lastNDays, weekRangeLabel, weekStart } from '../src/lib/date';
import { buildExport } from '../src/lib/exportJson';
import { habitHistory, habitRecordStart } from '../src/lib/habitHistory';
import { parseBackup } from '../src/lib/importJson';
import { searchDays } from '../src/lib/search';
import { sanitizeGoals, sanitizeHabits } from '../src/lib/storage';
import {
  CORE_HABITS,
  cleanGoal,
  DEFAULT_SETTINGS,
  EMPTY_DAY,
  goalsOf,
  GOALS_STORED_MAX,
  initialState,
  mergeBackup,
  reducer,
  unfinishedGoalsBefore,
  WEEK_GOALS_MAX,
  type Action,
  type DayLog,
  type Habit,
  type HubState,
  type WeekGoal,
} from '../src/lib/store';
import { monthSummary } from '../src/lib/summary';

const run = (state: HubState, ...actions: Action[]): HubState => actions.reduce(reducer, state);
const WEEK = '2026-11-15'; // its Sunday
const LAST = '2026-11-08';
const goal = (id: string, text: string, week = WEEK, createdAt = 1, doneAt?: number): WeekGoal => ({
  id,
  text,
  week,
  createdAt,
  ...(doneAt ? { doneAt } : {}),
});

describe('weeks', () => {
  test('run Sunday to Saturday, like the calendar', () => {
    expect(weekStart('2026-11-21')).toBe('2026-11-15');
    expect(weekStart('2026-11-15')).toBe('2026-11-15');
    expect(weekStart('2026-11-16')).toBe('2026-11-15');
    expect(weekStart('2027-01-01')).toBe('2026-12-27');
    // Across the clocks going back (Nov 1, 2026 in the US): still calendar days.
    expect(addDays('2026-10-31', 2)).toBe('2026-11-02');
    expect(addDays('2026-03-07', 2)).toBe('2026-03-09');
  });

  test('are named by their days', () => {
    expect(weekRangeLabel('2026-11-15')).toBe('Nov 15 – 21');
    expect(weekRangeLabel('2026-11-29')).toBe('Nov 29 – Dec 5');
    expect(weekRangeLabel('2026-12-27')).toBe('Dec 27 – Jan 2');
  });
});

describe('weekly goals', () => {
  test('up to three a week, cleaned, in the order written', () => {
    const s = run(
      initialState,
      { type: 'addGoal', goal: goal('a', '  Finish   the report ', WEEK, 3) },
      { type: 'addGoal', goal: goal('b', 'Call Mum', WEEK, 1) },
      { type: 'addGoal', goal: goal('c', '   ', WEEK, 2) },
      { type: 'addGoal', goal: goal('d', 'Run 10k', WEEK, 4) },
      { type: 'addGoal', goal: goal('e', 'One too many', WEEK, 5) },
      { type: 'addGoal', goal: goal('a', 'Same id again', LAST, 6) },
    );
    expect(goalsOf(s.goals, WEEK).map((g) => [g.id, g.text])).toEqual([
      ['b', 'Call Mum'],
      ['a', 'Finish the report'],
      ['d', 'Run 10k'],
    ]);
    expect(s.goals).toHaveLength(WEEK_GOALS_MAX);
  });

  test('a goal on any day of a week is filed under its Sunday', () => {
    expect(cleanGoal(goal('a', 'x', '2026-11-19'))?.week).toBe(WEEK);
    expect(cleanGoal(goal('a', 'x', '2026-02-31'))).toBeNull();
    expect(cleanGoal({ ...goal('a', 'x'), createdAt: Number.NaN })).toBeNull();
    expect(cleanGoal(goal('a', 'x'.repeat(500)))?.text).toHaveLength(80);
  });

  test('tick, untick, delete, and undo by adding it back', () => {
    let s = reducer(initialState, { type: 'addGoal', goal: goal('a', 'Finish the report') });
    s = reducer(s, { type: 'toggleGoal', id: 'a', now: 50 });
    expect(s.goals[0].doneAt).toBe(50);
    s = reducer(s, { type: 'toggleGoal', id: 'a', now: 60 });
    expect(s.goals[0]).not.toHaveProperty('doneAt');
    expect(reducer(s, { type: 'toggleGoal', id: 'nope', now: 1 })).toBe(s);
    const g = s.goals[0];
    s = reducer(s, { type: 'deleteGoal', id: 'a' });
    expect(s.goals).toEqual([]);
    expect(reducer(s, { type: 'addGoal', goal: g }).goals).toEqual([g]);
  });

  test('last week’s unfinished goals come into this week, as many as fit', () => {
    let s = run(
      initialState,
      { type: 'addGoal', goal: goal('l1', 'Done last week', LAST, 1, 99) },
      { type: 'addGoal', goal: goal('l2', 'Not done', LAST, 2) },
      { type: 'addGoal', goal: goal('l3', 'Also not done', LAST, 3) },
      { type: 'addGoal', goal: goal('t1', 'This week already', WEEK, 10) },
      { type: 'addGoal', goal: goal('t2', 'And another', WEEK, 11) },
    );
    const leftover = unfinishedGoalsBefore(s.goals, WEEK);
    expect(leftover.map((g) => g.id)).toEqual(['l2', 'l3']);
    s = reducer(s, { type: 'moveGoals', ids: leftover.map((g) => g.id), week: WEEK });
    // One spot was free: the first goes, the second stays where it was.
    expect(goalsOf(s.goals, WEEK).map((g) => g.id)).toEqual(['l2', 't1', 't2']);
    expect(goalsOf(s.goals, LAST).map((g) => g.id)).toEqual(['l1', 'l3']);
    // Full now: nothing more moves. A done goal never does, nor into an earlier week.
    expect(reducer(s, { type: 'moveGoals', ids: ['l3'], week: WEEK })).toBe(s);
    expect(reducer(s, { type: 'moveGoals', ids: ['t1'], week: LAST })).toBe(s);
  });

  test('stored goals are checked, three a week, newest week first, and capped', () => {
    const raw = [
      goal('a', 'One', WEEK, 1),
      goal('a', 'Duplicate id', WEEK, 2),
      goal('b', 'Two', WEEK, 2),
      goal('c', 'Three', WEEK, 3),
      goal('d', 'Four is over the limit', WEEK, 4),
      goal('e', 'Last week', LAST, 1),
      { id: 'f', text: 'Bad week', week: 'tomorrow', createdAt: 1 },
      { id: 'g', text: '', week: WEEK, createdAt: 1 },
      { id: 'h', text: 'Bad time', week: WEEK, createdAt: -5 },
      { id: 'i', text: 'Done', week: '2026-11-11', createdAt: 1, doneAt: 'yesterday' },
      'junk',
    ];
    expect(sanitizeGoals(raw).map((g) => [g.id, g.week, g.doneAt])).toEqual([
      ['a', WEEK, undefined],
      ['b', WEEK, undefined],
      ['c', WEEK, undefined],
      ['e', LAST, undefined],
      ['i', LAST, undefined],
    ]);
    expect(sanitizeGoals({})).toEqual([]);
    // Years of weeks: only the newest are kept.
    const many = Array.from({ length: GOALS_STORED_MAX + 30 }, (_, i) =>
      goal(`m${i}`, `Goal ${i}`, addDays(WEEK, -7 * Math.floor(i / 3)), i + 1),
    );
    const kept = sanitizeGoals(many);
    expect(kept).toHaveLength(GOALS_STORED_MAX);
    expect(kept[0].week).toBe(WEEK);
  });

  test('backups carry goals; restoring merges by id, three a week, and twice adds nothing', () => {
    const goals = [goal('a', 'Finish the report'), goal('b', 'Call Mum', WEEK, 2, 5), goal('c', 'Older', LAST)];
    const { json } = buildExport({}, [...CORE_HABITS], DEFAULT_SETTINGS, new Date(2026, 10, 21), [], [], [], goals);
    const parsed = parseBackup(json, new Date(2026, 10, 21));
    expect(parsed.ok && parsed.backup.goals).toEqual([goals[0], goals[1], goals[2]]);

    const mine = run(
      initialState,
      { type: 'addGoal', goal: goal('x', 'Mine', WEEK, 7) },
      { type: 'addGoal', goal: goal('y', 'Mine too', WEEK, 8) },
    );
    const { state, stats } = mergeBackup(mine, [], {}, [], [], [], goals);
    // This week had room for one more; last week's goes in too.
    expect(stats.goalsAdded).toBe(2);
    expect(goalsOf(state.goals, WEEK).map((g) => g.id)).toEqual(['a', 'x', 'y']);
    expect(goalsOf(state.goals, LAST).map((g) => g.id)).toEqual(['c']);
    expect(mergeBackup(state, [], {}, [], [], [], goals).state).toBe(state);
  });

  test('search finds a goal, filed under its week’s Sunday', () => {
    const days: Record<string, DayLog> = {
      '2026-11-20': { ...EMPTY_DAY, focus: 'Report draft' },
      '2026-11-10': { ...EMPTY_DAY, notes: [{ id: 'n', text: 'report notes', createdAt: 1 }] },
    };
    const { hits } = searchDays(days, 'report', undefined, [], [goal('a', 'Finish the report')]);
    expect(hits.map((h) => [h.kind, h.date])).toEqual([
      ['focus', '2026-11-20'],
      ['goal', WEEK],
      ['note', '2026-11-10'],
    ]);
    expect(hits[1]).toMatchObject({ id: 'a', start: 11, length: 6, time: null });
  });
});

describe('habit history', () => {
  // A month of a habit planned Mon–Fri: done most weekdays, one skipped.
  const habit: Habit = { id: 'core-move', label: 'Move for 30 minutes', core: true, days: [1, 2, 3, 4, 5] };
  const withDays = (
    days: Record<string, Partial<DayLog>>,
    habits: Habit[] = [habit, ...CORE_HABITS.slice(1)],
  ): HubState => ({
    ...initialState,
    habits,
    days: Object.fromEntries(Object.entries(days).map(([d, v]) => [d, { ...EMPTY_DAY, ...v }])),
  });
  const done = { habitsDone: ['core-move'] };

  test('four weeks, Sunday to Saturday, with each day’s state', () => {
    const s = withDays({
      '2026-10-26': { water: 1 }, // the first day anything was logged: a Monday, not done
      '2026-10-27': done,
      '2026-10-28': done,
      '2026-10-29': done,
      '2026-10-30': done,
      '2026-11-02': done,
      '2026-11-03': { habitsSkipped: ['core-move'] },
      '2026-11-04': done,
      '2026-11-05': done,
      '2026-11-06': done,
      '2026-11-09': done,
      '2026-11-10': done,
      '2026-11-14': done, // a Saturday: not one of its days, but done
      '2026-11-16': done,
      '2026-11-17': done,
      '2026-11-18': done,
      '2026-11-19': done,
      '2026-11-20': done,
    });
    const h = habitHistory(s, 'core-move', '2026-11-20', 60);
    expect(h.cells).toHaveLength(28);
    expect(h.cells[0].date).toBe('2026-10-25');
    const at = (d: string) => h.cells.find((c) => c.date === d)?.status;
    expect(at('2026-10-25')).toBe('before'); // before the first record
    expect(at('2026-10-26')).toBe('missed');
    expect(at('2026-10-31')).toBe('off');
    expect(at('2026-11-03')).toBe('skipped');
    expect(at('2026-11-11')).toBe('missed');
    expect(at('2026-11-14')).toBe('done');
    expect(at('2026-11-20')).toBe('done');
    expect(at('2026-11-21')).toBe('future');
    // Planned: 20 weekdays from Oct 26 to Nov 20, less the skipped one = 19; done on 15 of them
    // (the Saturday tick isn't one of its days).
    expect([h.done, h.planned]).toEqual([15, 19]);
    // The best run steps over weekends and the skipped day: Oct 27 to Nov 10 is 10 in a row.
    expect(h.best).toBe(10);
  });

  test('today not ticked yet is still to do, and not counted', () => {
    const s = withDays({ '2026-11-16': done, '2026-11-17': done });
    const h = habitHistory(s, 'core-move', '2026-11-18', 60);
    expect(h.cells.find((c) => c.date === '2026-11-18')?.status).toBe('today');
    expect([h.done, h.planned, h.best]).toEqual([2, 2, 2]);
    const ticked = habitHistory(
      withDays({ '2026-11-16': done, '2026-11-17': done, '2026-11-18': done }),
      'core-move',
      '2026-11-18',
      60,
    );
    expect([ticked.done, ticked.planned, ticked.best]).toEqual([3, 3, 3]);
  });

  test('a custom habit counts from the day it was added, or its first tick if earlier', () => {
    const custom: Habit = { id: 'habit-1', label: 'Stretch', core: false, since: '2026-11-18' };
    const s = withDays({ '2026-11-01': { water: 2 }, '2026-11-19': { habitsDone: ['habit-1'] } }, [
      ...CORE_HABITS,
      custom,
    ]);
    const loaded = Array.from({ length: 60 }, (_, i) => addDays('2026-11-20', i - 59));
    expect(habitRecordStart(s, 'habit-1', loaded)).toBe('2026-11-18');
    const h = habitHistory(s, 'habit-1', '2026-11-20', 60);
    expect(h.cells.find((c) => c.date === '2026-11-17')?.status).toBe('before');
    expect([h.done, h.planned]).toEqual([1, 2]);
    // Restored from a backup with an older tick: that counts.
    const older = withDays({ '2026-11-10': { habitsDone: ['habit-1'] } }, [...CORE_HABITS, custom]);
    expect(habitRecordStart(older, 'habit-1', loaded)).toBe('2026-11-10');
    // Added before 1.11 (no date kept): from its first tick.
    const legacy = withDays({ '2026-11-01': { water: 2 }, '2026-11-12': { habitsDone: ['habit-1'] } }, [
      ...CORE_HABITS,
      { ...custom, since: undefined },
    ]);
    expect(habitRecordStart(legacy, 'habit-1', loaded)).toBe('2026-11-12');
    // The core four go back to the first day anything was logged.
    expect(habitRecordStart(legacy, 'core-read', loaded)).toBe('2026-11-01');
    expect(habitRecordStart(initialState, 'core-read', loaded)).toBeNull();
  });

  test('the date a habit was added is kept, checked, and survives a schedule change', () => {
    let s = reducer(initialState, {
      type: 'addHabit',
      habit: { id: 'h1', label: 'Stretch', core: false, since: '2026-11-21' },
    });
    s = reducer(s, { type: 'setHabitDays', id: 'h1', days: [1, 3] });
    expect(s.habits.find((h) => h.id === 'h1')).toEqual({
      id: 'h1',
      label: 'Stretch',
      core: false,
      days: [1, 3],
      since: '2026-11-21',
    });
    const bad = reducer(initialState, {
      type: 'addHabit',
      habit: { id: 'h2', label: 'Nope', core: false, since: 'soon' },
    });
    expect(bad.habits.find((h) => h.id === 'h2')).not.toHaveProperty('since');
    const stored = sanitizeHabits([
      { id: 'h1', label: 'Stretch', since: '2026-11-21' },
      { id: 'h2', label: 'Walk', since: '2026-13-01' },
    ]);
    expect(stored.find((h) => h.id === 'h1')?.since).toBe('2026-11-21');
    expect(stored.find((h) => h.id === 'h2')).not.toHaveProperty('since');
  });
});

describe('month mood', () => {
  test('the month’s usual mood is the mean of the days it was logged', () => {
    const days: Record<string, DayLog> = {
      '2026-11-01': { ...EMPTY_DAY, mood: 4 },
      '2026-11-02': { ...EMPTY_DAY, mood: 5 },
      '2026-11-03': { ...EMPTY_DAY, water: 3 },
    };
    expect(monthSummary(days, lastNDays('2026-11-03', 3), []).avgMood).toBe(4.5);
    expect(monthSummary({}, ['2026-11-01'], []).avgMood).toBeNull();
  });
});
