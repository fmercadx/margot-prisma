import { buildExport } from '../src/lib/exportJson';
import { parseBackup } from '../src/lib/importJson';
import { memoryDates, memoryOf } from '../src/lib/onThisDay';
import { searchDays } from '../src/lib/search';
import { sanitizeBills, sanitizePinned } from '../src/lib/storage';
import {
  billDueDate,
  billExpenseId,
  BILLS_MAX,
  CORE_HABITS,
  cleanBill,
  DEFAULT_SETTINGS,
  EMPTY_DAY,
  getDay,
  initialState,
  mergeBackup,
  ordinal,
  PINNED_MAX,
  reducer,
  type Action,
  type Bill,
  type DayLog,
  type HubState,
} from '../src/lib/store';

const run = (state: HubState, ...actions: Action[]): HubState => actions.reduce(reducer, state);
const D = '2026-11-21';
const note = (id: string, text: string, createdAt = 1, task?: true) => ({ id, text, createdAt, ...(task ? { task } : {}) });
const withNotes = (...notes: ReturnType<typeof note>[]): HubState => ({
  ...initialState,
  days: { [D]: { ...EMPTY_DAY, notes } },
});
const rent: Bill = { id: 'b1', label: 'Rent', cents: 120_000, category: 'bills', day: 1 };

describe('pinned notes', () => {
  test('a plain note moves from its day to the top; to-dos stay', () => {
    const s0 = withNotes(note('n1', 'Gate code 4321'), note('t1', 'Call Sam', 2, true));
    const s = reducer(s0, { type: 'pinNote', date: D, id: 'n1', now: 99 });
    expect(getDay(s, D).notes.map((n) => n.id)).toEqual(['t1']);
    expect(s.pinned).toEqual([{ id: 'n1', text: 'Gate code 4321', createdAt: 1, pinnedAt: 99 }]);
    expect(reducer(s, { type: 'pinNote', date: D, id: 't1', now: 100 })).toBe(s);
    expect(reducer(s, { type: 'pinNote', date: D, id: 'nope', now: 100 })).toBe(s);
  });

  test(`at most ${PINNED_MAX}`, () => {
    let s = withNotes(...Array.from({ length: PINNED_MAX + 1 }, (_, i) => note(`n${i}`, `Note ${i}`)));
    for (let i = 0; i <= PINNED_MAX; i++) s = reducer(s, { type: 'pinNote', date: D, id: `n${i}`, now: i + 10 });
    expect(s.pinned).toHaveLength(PINNED_MAX);
    expect(getDay(s, D).notes).toHaveLength(1);
  });

  test('unpinning puts it into the day as a note written now', () => {
    const s = run(
      withNotes(note('n1', 'Gate code 4321')),
      { type: 'pinNote', date: D, id: 'n1', now: 99 },
      { type: 'unpinNote', id: 'n1', date: '2026-11-22', now: 500 },
    );
    expect(s.pinned).toEqual([]);
    expect(getDay(s, '2026-11-22').notes).toEqual([{ id: 'n1', text: 'Gate code 4321', createdAt: 500 }]);
  });

  test('delete, and undo puts it back in pinned order', () => {
    let s = run(
      withNotes(note('a', 'A'), note('b', 'B')),
      { type: 'pinNote', date: D, id: 'a', now: 10 },
      { type: 'pinNote', date: D, id: 'b', now: 20 },
    );
    const a = s.pinned.find((p) => p.id === 'a')!;
    s = reducer(s, { type: 'deletePinned', id: 'a' });
    expect(s.pinned.map((p) => p.id)).toEqual(['b']);
    s = reducer(s, { type: 'restorePinned', pinned: a });
    expect(s.pinned.map((p) => p.id)).toEqual(['b', 'a']);
  });

  test('stored pinned notes are checked and capped', () => {
    const raw = [
      { id: 'a', text: 'x'.repeat(5000), createdAt: 1, pinnedAt: 3 },
      { id: 'a', text: 'duplicate', createdAt: 1, pinnedAt: 4 },
      { id: 'b', text: '   ', createdAt: 1, pinnedAt: 5 },
      { id: 'c', text: 'ok', createdAt: 'x', pinnedAt: 5 },
      ...Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, text: `P${i}`, createdAt: 1, pinnedAt: 10 + i })),
    ];
    const p = sanitizePinned(raw);
    expect(p).toHaveLength(PINNED_MAX);
    expect(p[0].text.length).toBeLessThanOrEqual(500);
    expect(new Set(p.map((x) => x.id)).size).toBe(p.length);
    expect(sanitizePinned('nope')).toEqual([]);
  });

  test('search finds a pinned note, labelled as such', () => {
    const { hits } = searchDays({}, 'gate', undefined, [{ id: 'n1', text: 'Gate code 4321', createdAt: new Date(2026, 10, 2).getTime(), pinnedAt: 9 }]);
    expect(hits).toMatchObject([{ kind: 'pinned', id: 'n1', date: '2026-11-02', start: 0, length: 4 }]);
  });
});

describe('monthly bills', () => {
  test('a bill falls on its day, or the month’s last day', () => {
    expect(billDueDate({ day: 1 }, '2026-11-21')).toBe('2026-11-01');
    expect(billDueDate({ day: 31 }, '2026-11-05')).toBe('2026-11-30');
    expect(billDueDate({ day: 30 }, '2027-02-10')).toBe('2027-02-28');
    expect(billDueDate({ day: 30 }, '2028-02-10')).toBe('2028-02-29');
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(ordinal)).toEqual([
      '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '31st',
    ]);
  });

  test('a bill is checked like an expense', () => {
    expect(cleanBill({ ...rent, label: '  Rent   flat ' })?.label).toBe('Rent flat');
    for (const bad of [{ label: ' ' }, { cents: 0 }, { cents: 1.5 }, { day: 0 }, { day: 32 }, { category: 'nope' as never }]) {
      expect(cleanBill({ ...rent, ...bad })).toBeNull();
    }
    expect(cleanBill({ ...rent, lastPosted: 'garbage' })).not.toHaveProperty('lastPosted');
  });

  test('add, change the day, remove; at most twenty', () => {
    let s = reducer(initialState, { type: 'addBill', bill: rent });
    s = reducer(s, { type: 'setBillDay', id: 'b1', day: 3 });
    expect(s.bills[0].day).toBe(3);
    expect(reducer(s, { type: 'setBillDay', id: 'b1', day: 0 })).toBe(s);
    s = reducer(s, { type: 'removeBill', id: 'b1' });
    expect(s.bills).toEqual([]);
    for (let i = 0; i < BILLS_MAX + 2; i++) s = reducer(s, { type: 'addBill', bill: { ...rent, id: `b${i}` } });
    expect(s.bills).toHaveLength(BILLS_MAX);
  });

  test('posted on its day once a month, with an id that can’t be doubled', () => {
    let s = reducer(initialState, { type: 'addBill', bill: { ...rent, lastPosted: '2026-10' } });
    s = reducer(s, { type: 'postBills', today: '2026-11-21' });
    const e = getDay(s, '2026-11-01').expenses;
    expect(e).toEqual([
      { id: billExpenseId('b1', '2026-11'), cents: 120_000, label: 'Rent', category: 'bills', createdAt: new Date(2026, 10, 1, 9).getTime() },
    ]);
    expect(s.bills[0].lastPosted).toBe('2026-11');
    // Again the same month: nothing.
    expect(reducer(s, { type: 'postBills', today: '2026-11-25' })).toBe(s);
    // Next month, again.
    s = reducer(s, { type: 'postBills', today: '2026-12-01' });
    expect(getDay(s, '2026-12-01').expenses.map((x) => x.id)).toEqual([billExpenseId('b1', '2026-12')]);
  });

  test('a bill not due yet waits', () => {
    const s = reducer(initialState, { type: 'addBill', bill: { ...rent, day: 28 } });
    expect(reducer(s, { type: 'postBills', today: '2026-11-21' })).toBe(s);
    expect(getDay(reducer(s, { type: 'postBills', today: '2026-11-28' }), '2026-11-28').expenses).toHaveLength(1);
  });

  test('a restored backup holding this month’s posting doesn’t double it', () => {
    let s = reducer(initialState, { type: 'addBill', bill: rent });
    s = reducer(s, { type: 'postBills', today: '2026-11-21' });
    const theirs: DayLog = { ...EMPTY_DAY, expenses: [...getDay(s, '2026-11-01').expenses] };
    const merged = mergeBackup(s, [], { '2026-11-01': theirs }, [], [], [rent]).state;
    expect(getDay(merged, '2026-11-01').expenses).toHaveLength(1);
    expect(merged.bills).toHaveLength(1);
  });

  test('stored bills are checked, capped and sorted by day', () => {
    const b = sanitizeBills([
      { id: 'x', label: 'Phone', cents: 3000, category: 'bills', day: 15 },
      { id: 'y', label: 'Rent', cents: 120000, category: 'nope', day: 1, lastPosted: '2026-11' },
      { id: 'z', label: '', cents: 100, category: 'bills', day: 3 },
      { id: 'w', label: 'Bad day', cents: 100, category: 'bills', day: 40 },
      'junk',
    ]);
    expect(b.map((x) => [x.id, x.day, x.category, x.lastPosted])).toEqual([
      ['y', 1, 'other', '2026-11'],
      ['x', 15, 'bills', undefined],
    ]);
  });
});

describe('backups carry pinned notes and bills', () => {
  test('exported, read back, and merged by id with counts', () => {
    const pinned = [{ id: 'p1', text: 'Gate code 4321', createdAt: 1, pinnedAt: 2 }];
    const { json } = buildExport({}, [...CORE_HABITS], DEFAULT_SETTINGS, new Date(2026, 10, 21), [], pinned, [rent]);
    const parsed = parseBackup(json, new Date(2026, 10, 21));
    expect(parsed.ok && parsed.backup.pinned).toEqual(pinned);
    expect(parsed.ok && parsed.backup.bills).toEqual([rent]);
    const { state, stats } = mergeBackup(initialState, [], {}, [], pinned, [rent]);
    expect(stats).toMatchObject({ pinnedAdded: 1, billsAdded: 1 });
    expect(mergeBackup(state, [], {}, [], pinned, [rent]).state).toBe(state);
  });
});

describe('on this day', () => {
  test('a week, a month and a year back, clamped in short months', () => {
    expect(memoryDates('2026-11-21')).toEqual([
      { label: 'A week ago', date: '2026-11-14' },
      { label: 'A month ago', date: '2026-10-21' },
      { label: 'A year ago', date: '2025-11-21' },
    ]);
    expect(memoryDates('2027-03-31').map((m) => m.date)).toEqual(['2027-03-24', '2027-02-28', '2026-03-31']);
    expect(memoryDates('2028-02-29').map((m) => m.date)[2]).toBe('2027-02-28');
  });

  test('only what was written: focus, good things, the first journal line, else the oldest note', () => {
    expect(memoryOf('A', D, null)).toBeNull();
    expect(memoryOf('A', D, { ...EMPTY_DAY, water: 5, mood: 4 })).toBeNull();
    expect(memoryOf('A', D, { ...EMPTY_DAY, notes: [note('t', 'To-do', 1, true)] })).toBeNull();
    expect(memoryOf('A', D, { ...EMPTY_DAY, focus: 'Ship it', gratitude: ['Sun'], journal: '\nGood day.\nMore.' })).toEqual({
      label: 'A', date: D, focus: 'Ship it', good: ['Sun'], journal: 'Good day.', note: '',
    });
    expect(memoryOf('A', D, { ...EMPTY_DAY, notes: [note('n2', 'Later', 2), note('n1', 'First', 1)] })?.note).toBe('First');
  });
});
