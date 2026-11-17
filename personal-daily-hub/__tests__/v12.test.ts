import { buildExport } from '../src/lib/exportJson';
import { IMPORT_MAX_BYTES, parseBackup } from '../src/lib/importJson';
import { moodWord } from '../src/lib/mood';
import {
  CORE_HABITS,
  CUSTOM_HABITS_MAX,
  DEFAULT_SETTINGS,
  EMPTY_DAY,
  getDay,
  initialState,
  mergeBackup,
  reducer,
  type Action,
  type DayLog,
  type HubState,
} from '../src/lib/store';
import { weekSummary } from '../src/lib/summary';

const TODAY = '2026-11-08';
const run = (...actions: Action[]): HubState => actions.reduce(reducer, initialState);
const note = (id: string, text: string, createdAt = 1) => ({ id, text, createdAt });
const day = (over: Partial<DayLog>): DayLog => ({ ...EMPTY_DAY, ...over });

describe('mood', () => {
  test('is set, clamped to 1–5, and cleared with null', () => {
    let s = run({ type: 'setMood', date: TODAY, value: 4 });
    expect(getDay(s, TODAY).mood).toBe(4);
    s = reducer(s, { type: 'setMood', date: TODAY, value: 9 });
    expect(getDay(s, TODAY).mood).toBe(5);
    s = reducer(s, { type: 'setMood', date: TODAY, value: null });
    expect(getDay(s, TODAY).mood).toBeNull();
    expect(moodWord(4)).toBe('Good');
  });
});

describe('editing a note', () => {
  test('changes the text, keeps id and time, and records when', () => {
    let s = run({ type: 'addNote', date: TODAY, note: note('n', 'Call dentist', 100) });
    s = reducer(s, { type: 'editNote', date: TODAY, id: 'n', text: '  Call the dentist at 3  ', now: 500 });
    expect(getDay(s, TODAY).notes[0]).toEqual({ id: 'n', text: 'Call the dentist at 3', createdAt: 100, editedAt: 500 });
  });

  test('a blank or unchanged edit, or an unknown id, changes nothing', () => {
    const s = run({ type: 'addNote', date: TODAY, note: note('n', 'Keep me') });
    expect(reducer(s, { type: 'editNote', date: TODAY, id: 'n', text: '   ', now: 2 })).toBe(s);
    expect(reducer(s, { type: 'editNote', date: TODAY, id: 'n', text: 'Keep me', now: 2 })).toBe(s);
    expect(reducer(s, { type: 'editNote', date: TODAY, id: 'nope', text: 'x', now: 2 })).toBe(s);
  });
});

describe('mergeBackup', () => {
  const phone = run(
    { type: 'addNote', date: TODAY, note: note('a', 'on the phone', 10) },
    { type: 'adjustWater', date: TODAY, delta: 2 },
    { type: 'setMood', date: TODAY, value: 2 },
  );

  test('adds new days, combines shared days by id, and never overwrites the phone', () => {
    const backup = {
      '2026-11-01': day({ water: 5 }),
      [TODAY]: day({
        notes: [note('a', 'edited elsewhere', 10), note('b', 'only in backup', 20)],
        water: 6,
        energy: 7,
        mood: 5,
      }),
    };
    const { state, stats } = mergeBackup(phone, [], backup);
    expect(stats).toEqual({ daysAdded: 1, daysMerged: 1, notesAdded: 1, expensesAdded: 0, habitsAdded: 0 });
    const t = getDay(state, TODAY);
    expect(t.notes.map((n) => n.text)).toEqual(['only in backup', 'on the phone']); // phone's 'a' kept
    expect(t.water).toBe(6); // the larger count
    expect(t.energy).toBe(7); // the phone had none
    expect(t.mood).toBe(2); // the phone's value wins
    expect(getDay(state, '2026-11-01').water).toBe(5);
  });

  test('restoring the same backup twice changes nothing the second time', () => {
    const backup = { [TODAY]: day({ notes: [note('b', 'x', 20)] }), '2026-11-02': day({ energy: 3 }) };
    const once = mergeBackup(phone, [], backup).state;
    const twice = mergeBackup(once, [], backup);
    expect(twice.state).toBe(once);
    expect(Object.values(twice.stats).every((n) => n === 0)).toBe(true);
  });

  test('custom habits are added unless they clash or the limit is reached', () => {
    const withOne = run({ type: 'addHabit', habit: { id: 'h1', label: 'Stretch', core: false } });
    const incoming = [
      { id: 'h2', label: 'stretch', core: false }, // same name
      { id: 'h1', label: 'Other', core: false }, // same id
      { id: 'h3', label: 'Journal', core: false },
    ];
    const { state, stats } = mergeBackup(withOne, incoming, {});
    expect(stats.habitsAdded).toBe(1);
    expect(state.habits.filter((h) => !h.core).map((h) => h.label)).toEqual(['Stretch', 'Journal']);

    const many = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, label: `Habit ${i}`, core: false }));
    expect(mergeBackup(initialState, many, {}).state.habits).toHaveLength(CORE_HABITS.length + CUSTOM_HABITS_MAX);
  });
});

describe('parseBackup', () => {
  const now = new Date(2026, 10, 8, 12);
  const exported = buildExport(
    { [TODAY]: day({ notes: [note('n', 'Hello')], water: 3, mood: 4 }), '2026-10-01': day({ energy: 6 }) },
    [...CORE_HABITS, { id: 'h1', label: 'Stretch', core: false }],
    DEFAULT_SETTINGS,
    now,
  ).json;

  test('reads back an export from this app', () => {
    const r = parseBackup(exported, now);
    if (!r.ok) throw new Error(r.error);
    expect(Object.keys(r.backup.days)).toEqual(['2026-10-01', TODAY]);
    expect(r.backup.days[TODAY].notes[0].text).toBe('Hello');
    expect(r.backup.days[TODAY].mood).toBe(4);
    expect(r.backup.habits).toEqual([{ id: 'h1', label: 'Stretch', core: false }]);
    expect(r.backup.exportedAt).toBe(now.toISOString());
  });

  test.each([
    ['not JSON', 'hello', 'not a Daily Hub backup'],
    ['another app', JSON.stringify({ app: 'Something', format: 1, days: {} }), 'not a Daily Hub backup'],
    ['no days', JSON.stringify({ app: 'Personal Daily Hub', format: 1 }), 'not a Daily Hub backup'],
    ['a newer format', JSON.stringify({ app: 'Personal Daily Hub', format: 2, days: {} }), 'newer version'],
    ['too large', ' '.repeat(IMPORT_MAX_BYTES + 1), 'too large'],
  ])('refuses %s', (_name, text, message) => {
    const r = parseBackup(text, now);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(message);
  });

  test('drops impossible and future dates, junk entries, and keys like __proto__', () => {
    // A literal `__proto__:` would set the prototype rather than make a key,
    // so the raw key is spliced into the JSON text the way a crafted file would have it.
    const text = JSON.stringify({
      app: 'Personal Daily Hub',
      format: 1,
      days: {
        '2026-02-31': { water: 3 },
        '2027-01-01': { water: 3 }, // future
        PROTO_KEY: { water: 3 },
        constructor: { water: 3 },
        '2026-11-07': { water: 2, notes: [{ id: 'x', text: 1 }, 'junk'] },
        '2026-11-06': { notes: [] }, // empty: nothing to restore
      },
      habits: [{ id: 'core-read', label: 'Hijack', core: false }, { label: 'no id' }],
    }).replace('"PROTO_KEY"', '"__proto__"');
    expect(text).toContain('"__proto__"');
    const r = parseBackup(text, now);
    if (!r.ok) throw new Error(r.error);
    expect(Object.keys(r.backup.days)).toEqual(['2026-11-07']);
    expect(r.backup.days['2026-11-07']).toEqual(day({ water: 2 }));
    expect(r.backup.habits).toEqual([]);
    expect(({} as Record<string, unknown>).water).toBeUndefined(); // no prototype pollution
  });

  test('refuses more than ten years of days', () => {
    const days: Record<string, unknown> = {};
    const start = new Date(2000, 0, 1);
    for (let i = 0; i < 3661; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      days[`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`] = { water: 1 };
    }
    const r = parseBackup(JSON.stringify({ app: 'Personal Daily Hub', format: 1, days }), now);
    expect(r.ok).toBe(false);
  });
});

describe('weekSummary', () => {
  test('averages only what was logged, counts every day for habits, and totals spending', () => {
    const days = [
      { log: day({ water: 4, energy: 6, habitsDone: ['core-read'] }) },
      { log: day({ water: 8, mood: 4, expenses: [{ id: 'e', cents: 1250, label: '', createdAt: 1 }] }) },
      { log: null },
      { log: day({ habitsDone: ['core-read', 'core-move', 'gone'] }) },
    ];
    const s = weekSummary(days, ['core-read', 'core-move']);
    expect(s.avgWater).toBe(6);
    expect(s.avgEnergy).toBe(6);
    expect(s.avgMood).toBe(4);
    expect(s.spentCents).toBe(1250);
    expect(s.habitRate).toBe(3 / 8); // 3 ticks of 4 days × 2 habits; "gone" isn't a habit any more
  });

  test('nothing logged gives nulls, not zeros', () => {
    const s = weekSummary([{ log: null }, { log: null }], ['core-read']);
    expect(s).toEqual({ avgWater: null, avgEnergy: null, avgMood: null, spentCents: 0, habitRate: 0 });
  });
});
