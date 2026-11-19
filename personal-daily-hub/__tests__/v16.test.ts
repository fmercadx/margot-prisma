import { HIDDEN_AMOUNT } from '../src/components/Money';
import { formatCents } from '../src/lib/money';
import { buildExpensesCsv, csvCell } from '../src/lib/exportCsv';
import { buildExport } from '../src/lib/exportJson';
import { parseBackup } from '../src/lib/importJson';
import { describeInsight, findInsights } from '../src/lib/insights';
import { lastNDays } from '../src/lib/date';
import { sanitizeCountdowns } from '../src/lib/storage';
import {
  CORE_HABITS,
  COUNTDOWNS_MAX,
  DEFAULT_SETTINGS,
  daysUntil,
  EMPTY_DAY,
  initialState,
  mergeBackup,
  reducer,
  type Countdown,
  type DayLog,
  type Expense,
  type HubState,
} from '../src/lib/store';

const TODAY = '2026-11-18'; // a Wednesday
const day = (over: Partial<DayLog>): DayLog => ({ ...EMPTY_DAY, ...over });
const cd = (id: string, label: string, date: string): Countdown => ({ id, label, date });
const exp = (id: string, cents: number, label: string, createdAt: number, category: Expense['category'] = 'food'): Expense => ({
  id,
  cents,
  label,
  category,
  createdAt,
});

describe('countdowns', () => {
  test('added trimmed and sorted soonest first; capped; one per id; removable', () => {
    let s = reducer(initialState, { type: 'addCountdown', countdown: cd('a', '  Lisbon trip ', '2026-12-05') });
    s = reducer(s, { type: 'addCountdown', countdown: cd('b', 'Mum’s birthday', '2026-11-25') });
    expect(s.countdowns).toEqual([cd('b', 'Mum’s birthday', '2026-11-25'), cd('a', 'Lisbon trip', '2026-12-05')]);
    expect(reducer(s, { type: 'addCountdown', countdown: cd('a', 'Again', '2027-01-01') })).toBe(s);
    expect(reducer(s, { type: 'addCountdown', countdown: cd('c', '   ', '2027-01-01') })).toBe(s);
    for (let i = 0; i < 20; i++) s = reducer(s, { type: 'addCountdown', countdown: cd(`x${i}`, `E${i}`, '2027-02-01') });
    expect(s.countdowns).toHaveLength(COUNTDOWNS_MAX);
    s = reducer(s, { type: 'removeCountdown', id: 'b' });
    expect(s.countdowns.some((c) => c.id === 'b')).toBe(false);
  });

  test('days until counts calendar days, across months and clock changes', () => {
    expect(daysUntil('2026-11-18', TODAY)).toBe(0);
    expect(daysUntil('2026-12-01', TODAY)).toBe(13);
    expect(daysUntil('2026-11-15', TODAY)).toBe(-3);
    expect(daysUntil('2026-03-09', '2026-03-07')).toBe(2); // US clocks change on Mar 8
    expect(daysUntil('2027-11-18', TODAY)).toBe(365);
  });

  test('sanitized: real dates and a name only, one per id, capped, sorted', () => {
    const list = sanitizeCountdowns([
      cd('a', 'Trip', '2026-12-05'),
      cd('b', 'Bad date', '2026-02-30'),
      cd('c', '   ', '2026-12-01'),
      cd('a', 'Duplicate', '2026-12-09'),
      { id: 'd', label: 'Early', date: '2026-11-20', extra: 'ignored' },
      'junk',
      ...Array.from({ length: 30 }, (_, i) => cd(`m${i}`, `Many ${i}`, '2027-05-01')),
    ]);
    expect(list.slice(0, 2)).toEqual([cd('d', 'Early', '2026-11-20'), cd('a', 'Trip', '2026-12-05')]);
    expect(list).toHaveLength(COUNTDOWNS_MAX);
    expect(list.some((c) => c.id === 'b' || c.id === 'c')).toBe(false);
  });

  test('exported, read back from a backup, and merged by id without replacing the phone’s', () => {
    const { json } = buildExport({}, [...CORE_HABITS], DEFAULT_SETTINGS, new Date(2026, 10, 18, 12), [cd('a', 'Trip', '2026-12-05')]);
    const parsed = parseBackup(json, new Date(2026, 10, 18));
    expect(parsed.ok && parsed.backup.countdowns).toEqual([cd('a', 'Trip', '2026-12-05')]);

    const s: HubState = { ...initialState, countdowns: [cd('a', 'Mine', '2026-12-24')] };
    const { state, stats } = mergeBackup(s, [], {}, [cd('a', 'Theirs', '2026-12-05'), cd('b', 'New', '2026-11-30')]);
    expect(state.countdowns).toEqual([cd('b', 'New', '2026-11-30'), cd('a', 'Mine', '2026-12-24')]);
    expect(stats.countdownsAdded).toBe(1);
    expect(mergeBackup(state, [], {}, [cd('b', 'New', '2026-11-30')]).state).toBe(state);
  });
});

describe('renaming habits', () => {
  test('custom only, trimmed, never blank, never a name already taken', () => {
    let s = reducer(initialState, { type: 'addHabit', habit: { id: 'c1', label: 'Stretch', core: false } });
    s = reducer(s, { type: 'renameHabit', id: 'c1', label: '  Stretch for 5 minutes ' });
    expect(s.habits.find((h) => h.id === 'c1')?.label).toBe('Stretch for 5 minutes');
    expect(reducer(s, { type: 'renameHabit', id: 'c1', label: '   ' })).toBe(s);
    expect(reducer(s, { type: 'renameHabit', id: 'c1', label: 'read 20 PAGES' })).toBe(s);
    expect(reducer(s, { type: 'renameHabit', id: 'core-read', label: 'Something else' })).toBe(s);
  });
});

describe('expenses as CSV', () => {
  test('oldest first, exact amounts, categories, a BOM and CRLF line ends', () => {
    const t = (h: number, m: number) => new Date(2026, 10, 17, h, m).getTime();
    const { csv, rows, filename } = buildExpensesCsv(
      {
        '2026-11-18': day({ expenses: [exp('b', 5, 'Gum', new Date(2026, 10, 18, 9, 5).getTime())] }),
        '2026-11-17': day({ expenses: [exp('a2', 100000, 'Rent', t(18, 0), 'bills'), exp('a1', 450, '', t(8, 30))] }),
      },
      new Date(2026, 10, 18),
    );
    expect(filename).toBe('personal-daily-hub-expenses-2026-11-18.csv');
    expect(rows).toBe(3);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.slice(1).split('\r\n')).toEqual([
      'Date,Time,Amount,Category,Label',
      '2026-11-17,08:30,4.50,Food,',
      '2026-11-17,18:00,1000.00,Bills,Rent',
      '2026-11-18,09:05,0.05,Food,Gum',
      '',
    ]);
  });

  test('labels are quoted when needed and can never run as a formula', () => {
    expect(csvCell('Lunch, with Sam')).toBe('"Lunch, with Sam"');
    expect(csvCell('The "good" one')).toBe('"The ""good"" one"');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell('=HYPERLINK("http://x","click")')).toBe(`"'=HYPERLINK(""http://x"",""click"")"`);
    for (const lead of ['+', '-', '@', '\t', '\r']) expect(csvCell(`${lead}1+1`).startsWith(`'`) || csvCell(`${lead}1+1`).startsWith(`"'`)).toBe(true);
    expect(csvCell('Plain')).toBe('Plain');
  });
});

describe('insights', () => {
  // Twelve days: nights of 8 hours go with energy 8 and mood 4; nights of 5 with energy 4 and mood 3.
  const days: Record<string, DayLog> = Object.fromEntries(
    lastNDays(TODAY, 12).map((date, i) => {
      const good = i % 2 === 0;
      return [
        date,
        day({
          sleep: good ? 8 : 5,
          energy: good ? 8 : 4,
          mood: good ? 4 : 3,
          water: good ? 8 : 3,
          habitsDone: good ? ['core-move'] : [],
        }),
      ];
    }),
  );

  test('finds the strongest patterns, with the averages behind them', () => {
    const found = findInsights(days, [...CORE_HABITS], 8);
    const kinds = found.map((i) => i.kind);
    expect(kinds).toEqual(expect.arrayContaining(['sleep-energy', 'sleep-mood', 'habit-mood', 'water-energy']));
    expect(found.length).toBeLessThanOrEqual(4);
    const se = found.find((i) => i.kind === 'sleep-energy')!;
    expect(describeInsight(se, formatCents)).toBe(
      'After 7 or more hours of sleep, your energy averaged 8.0 out of 10, against 4.0 after less.',
    );
    const hm = found.find((i) => i.kind === 'habit-mood')!;
    expect(describeInsight(hm, formatCents)).toContain('“Move for 30 minutes”');
  });

  test('says nothing until each side has enough days, or when the gap is small', () => {
    const few = Object.fromEntries(Object.entries(days).slice(0, 6));
    expect(findInsights(few, [...CORE_HABITS], 8)).toEqual([]);
    const flat = Object.fromEntries(Object.entries(days).map(([d, l]) => [d, { ...l, energy: 6, mood: 3, habitsDone: [] }]));
    expect(findInsights(flat, [...CORE_HABITS], 8).map((i) => i.kind)).not.toContain('sleep-energy');
  });

  test('a habit only counts when the mood was higher, and only on its days', () => {
    const worse = Object.fromEntries(
      Object.entries(days).map(([d, l]) => [d, { ...l, habitsDone: l.mood === 3 ? ['core-move'] : [] }]),
    );
    expect(findInsights(worse, [...CORE_HABITS], 8).map((i) => i.kind)).not.toContain('habit-mood');
  });

  test('the priciest weekday, with amounts that "Hide amounts" can mask', () => {
    const spend: Record<string, DayLog> = Object.fromEntries(
      lastNDays(TODAY, 28).map((date) => {
        const sat = new Date(`${date}T12:00:00`).getDay() === 6;
        return [date, day({ water: 1, expenses: [exp(date, sat ? 9000 : 1000, '', 1)] })];
      }),
    );
    const top = findInsights(spend, [], 8).find((i) => i.kind === 'spend-weekday')!;
    expect(describeInsight(top, formatCents)).toBe('You spend the most on Saturdays: $90.00 on average, against $10.00 on other days.');
    expect(describeInsight(top, () => HIDDEN_AMOUNT)).toBe(`You spend the most on Saturdays: ${HIDDEN_AMOUNT} on average, against ${HIDDEN_AMOUNT} on other days.`);
  });
});
