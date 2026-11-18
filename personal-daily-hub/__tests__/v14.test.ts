import { sleepLabel } from '../src/components/WaterEnergy';
import { sanitizeDay, sanitizeSettings } from '../src/lib/storage';
import {
  EMPTY_DAY,
  initialState,
  mergeBackup,
  openTasksBefore,
  reducer,
  type DayLog,
  type HubState,
  type Note,
} from '../src/lib/store';
import { monthSummary, weekSummary } from '../src/lib/summary';

const TODAY = '2026-11-18';
const day = (over: Partial<DayLog>): DayLog => ({ ...EMPTY_DAY, ...over });
const task = (id: string, text: string, over: Partial<Note> = {}): Note => ({ id, text, createdAt: 1, task: true, ...over });
const withDays = (days: Record<string, DayLog>): HubState => ({ ...initialState, days });

describe('to-dos', () => {
  test('a to-do ticks off and back; a plain note cannot be ticked', () => {
    let s = reducer(initialState, { type: 'addNote', date: TODAY, note: task('t', 'Buy milk') });
    s = reducer(s, { type: 'addNote', date: TODAY, note: { id: 'n', text: 'An idea', createdAt: 2 } });
    s = reducer(s, { type: 'toggleTask', date: TODAY, id: 't', now: 500 });
    expect(s.days[TODAY].notes.find((n) => n.id === 't')).toMatchObject({ task: true, doneAt: 500 });
    s = reducer(s, { type: 'toggleTask', date: TODAY, id: 't', now: 600 });
    expect(s.days[TODAY].notes.find((n) => n.id === 't')).not.toHaveProperty('doneAt');
    expect(reducer(s, { type: 'toggleTask', date: TODAY, id: 'n', now: 700 })).toBe(s);
  });

  test('unfinished to-dos from the last seven days are offered, newest day first', () => {
    const s = withDays({
      '2026-11-17': day({
        notes: [task('a', 'Call the bank'), task('b', 'Pay rent', { doneAt: 5 }), { id: 'c', text: 'Plain', createdAt: 1 }],
      }),
      '2026-11-15': day({ notes: [task('d', 'Book flights'), task('e', 'Moved', { carriedTo: '2026-11-16' })] }),
      '2026-11-10': day({ notes: [task('f', 'Too old to offer')] }),
      [TODAY]: day({ notes: [task('g', 'Already today')] }),
    });
    expect(openTasksBefore(s, TODAY).map((t) => [t.from, t.note.id])).toEqual([
      ['2026-11-17', 'a'],
      ['2026-11-15', 'd'],
    ]);
  });

  test('bringing them over moves each once: copies today, originals marked', () => {
    const s = withDays({
      '2026-11-17': day({ notes: [task('a', 'Call the bank')] }),
      [TODAY]: day({ notes: [{ id: 'x', text: 'Existing', createdAt: 100 }] }),
    });
    const carry = {
      type: 'carryOver' as const,
      to: TODAY,
      items: [{ from: '2026-11-17', id: 'a', copy: { id: 'a2', createdAt: 900 } }],
    };
    const next = reducer(s, carry);
    expect(next.days[TODAY].notes.map((n) => n.id)).toEqual(['a2', 'x']);
    expect(next.days[TODAY].notes[0]).toEqual({ id: 'a2', text: 'Call the bank', createdAt: 900, task: true, carriedFrom: '2026-11-17' });
    expect(next.days['2026-11-17'].notes[0].carriedTo).toBe(TODAY);
    expect(openTasksBefore(next, TODAY)).toEqual([]);
    expect(reducer(next, carry)).toBe(next); // a second time does nothing
    // Only from earlier days, and a brought-over original can't be ticked.
    expect(reducer(s, { ...carry, to: '2026-11-16' })).toBe(s);
    expect(reducer(next, { type: 'toggleTask', date: '2026-11-17', id: 'a', now: 1 })).toBe(next);
  });

  test('to-do fields are read back only on to-dos, and only when valid', () => {
    const d = sanitizeDay({
      notes: [
        { id: 'a', text: 'ok', createdAt: 1, task: true, doneAt: 9, carriedFrom: '2026-11-17', carriedTo: '2026-02-31' },
        { id: 'b', text: 'not a task', createdAt: 1, task: 'yes', doneAt: 9, carriedTo: '2026-11-18' },
        { id: 'c', text: 'bad time', createdAt: 1, task: true, doneAt: -4 },
      ],
    });
    expect(d.notes).toEqual([
      { id: 'a', text: 'ok', createdAt: 1, task: true, doneAt: 9, carriedFrom: '2026-11-17' },
      { id: 'b', text: 'not a task', createdAt: 1 },
      { id: 'c', text: 'bad time', createdAt: 1, task: true },
    ]);
  });
});

describe('sleep', () => {
  test('half-hour steps between 0 and 14 hours; null clears it', () => {
    let s = reducer(initialState, { type: 'setSleep', date: TODAY, value: 7.3 });
    expect(s.days[TODAY].sleep).toBe(7.5);
    expect(hasSleep(reducer(s, { type: 'setSleep', date: TODAY, value: 30 }))).toBe(14);
    expect(hasSleep(reducer(s, { type: 'setSleep', date: TODAY, value: -2 }))).toBe(0);
    s = reducer(s, { type: 'setSleep', date: TODAY, value: null });
    expect(s.days[TODAY].sleep).toBeNull();
  });

  test('is sanitized on the way in, and a restore keeps the phone’s value', () => {
    expect(sanitizeDay({ sleep: 6.5 }).sleep).toBe(6.5);
    expect(sanitizeDay({ sleep: 6.2 }).sleep).toBe(6);
    for (const bad of [15, -1, '7', NaN, null]) expect(sanitizeDay({ sleep: bad }).sleep).toBeNull();
    const s = withDays({ [TODAY]: day({ sleep: 8 }), '2026-11-17': day({ water: 1 }) });
    const { state } = mergeBackup(s, [], { [TODAY]: day({ sleep: 5 }), '2026-11-17': day({ sleep: 6 }) });
    expect(state.days[TODAY].sleep).toBe(8);
    expect(state.days['2026-11-17'].sleep).toBe(6);
  });

  test('reads as hours and halves', () => {
    expect(sleepLabel(7.5)).toBe('7½ h');
    expect(sleepLabel(8)).toBe('8 h');
    expect(sleepLabel(0.5)).toBe('0½ h');
  });

  test('the weekly summary averages the nights logged', () => {
    expect(weekSummary([{ log: day({ sleep: 7 }) }, { log: day({ sleep: 8 }) }, { log: null }], []).avgSleep).toBe(7.5);
  });
});

function hasSleep(s: HubState) {
  return s.days[TODAY].sleep;
}

describe('relock timing', () => {
  test('only the offered choices are kept; anything else is 30 seconds', () => {
    expect(sanitizeSettings({}).relockAfterSec).toBe(30);
    expect(sanitizeSettings({ relockAfterSec: 0 }).relockAfterSec).toBe(0);
    expect(sanitizeSettings({ relockAfterSec: 300 }).relockAfterSec).toBe(300);
    for (const bad of [45, -1, '60', 86400]) expect(sanitizeSettings({ relockAfterSec: bad }).relockAfterSec).toBe(30);
    const s = reducer(initialState, { type: 'updateSettings', patch: { relockAfterSec: 60 } });
    expect(s.settings.relockAfterSec).toBe(60);
    expect(reducer(s, { type: 'updateSettings', patch: { relockAfterSec: 7 } })).toBe(s);
  });
});

describe('month summary', () => {
  test('habits over the days counted, money, sleep and categories', () => {
    const days = {
      '2026-11-01': day({ habitsDone: ['a', 'b'], sleep: 7, expenses: [{ id: 'e1', cents: 1000, label: '', category: 'food', createdAt: 1 }] }),
      '2026-11-02': day({ habitsDone: ['a', 'gone'], expenses: [{ id: 'e2', cents: 2500, label: '', category: 'bills', createdAt: 1 }] }),
      '2026-10-31': day({ habitsDone: ['a', 'b'], sleep: 4 }), // another month: not passed in
    };
    const s = monthSummary(days, ['2026-11-01', '2026-11-02', '2026-11-03'], ['a', 'b']);
    expect(s).toEqual({
      covered: 3,
      habitRate: 3 / 6,
      spentCents: 3500,
      avgSleep: 7,
      categories: [
        { category: 'bills', cents: 2500 },
        { category: 'food', cents: 1000 },
      ],
    });
    expect(monthSummary({}, [], ['a']).habitRate).toBeNull();
  });
});
