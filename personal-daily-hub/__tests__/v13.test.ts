import AsyncStorage from '@react-native-async-storage/async-storage';

import { BUDGET_STEPS_CENTS, categoryTotals, isCategory, stepBudget } from '../src/lib/categories';
import { plainCodec } from '../src/lib/codec';
import { parseBackup } from '../src/lib/importJson';
import { searchDays } from '../src/lib/search';
import {
  createPersister,
  eraseStoredData,
  sanitizeDay,
  sanitizeSettings,
  setCodec,
} from '../src/lib/storage';
import {
  EMPTY_DAY,
  expenseName,
  FOCUS_MAX_LENGTH,
  hasAnyData,
  initialState,
  mergeBackup,
  reducer,
  type DayLog,
  type Expense,
  type HubState,
} from '../src/lib/store';
import { weekSummary } from '../src/lib/summary';
import { habitLevel } from '../src/components/MonthCalendar';

const D = '2026-11-08';
const day = (over: Partial<DayLog>): DayLog => ({ ...EMPTY_DAY, ...over });
const exp = (id: string, cents: number, category: Expense['category'], label = ''): Expense => ({
  id,
  cents,
  label,
  category,
  createdAt: 1,
});

beforeEach(async () => {
  await AsyncStorage.clear();
  setCodec(plainCodec);
});

describe("today's focus", () => {
  test('is one trimmed line, capped, and clearing it clears it', () => {
    let s = reducer(initialState, { type: 'setFocus', date: D, text: '  Finish the\nreport  ' });
    expect(s.days[D].focus).toBe('Finish the report');
    expect(hasAnyData(s.days[D])).toBe(true);
    expect(reducer(s, { type: 'setFocus', date: D, text: 'Finish the report ' })).toBe(s); // unchanged
    s = reducer(s, { type: 'setFocus', date: D, text: 'x'.repeat(500) });
    expect(s.days[D].focus).toHaveLength(FOCUS_MAX_LENGTH);
    s = reducer(s, { type: 'setFocus', date: D, text: '   ' });
    expect(s.days[D].focus).toBe('');
  });

  test('is sanitized on the way in: not a string, or whitespace, is no focus', () => {
    expect(sanitizeDay({ focus: 42 }).focus).toBe('');
    expect(sanitizeDay({ focus: ' \n ' }).focus).toBe('');
    expect(sanitizeDay({ focus: 'a\tb' }).focus).toBe('a b');
    expect(sanitizeDay({ focus: 'z'.repeat(10_000) }).focus).toHaveLength(FOCUS_MAX_LENGTH);
  });

  test('restoring a backup keeps the phone’s focus and fills in a missing one', () => {
    const state: HubState = { ...initialState, days: { [D]: day({ focus: 'Mine' }), '2026-11-07': day({ water: 2 }) } };
    const { state: next } = mergeBackup(state, [], {
      [D]: day({ focus: 'Theirs' }),
      '2026-11-07': day({ focus: 'Filled in' }),
    });
    expect(next.days[D]).toBe(state.days[D]); // nothing changed there
    expect(next.days['2026-11-07'].focus).toBe('Filled in');
  });
});

describe('expense categories', () => {
  test('an expense keeps its category; an unknown one becomes "other"', () => {
    let s = reducer(initialState, { type: 'addExpense', date: D, expense: exp('a', 500, 'food') });
    s = reducer(s, { type: 'addExpense', date: D, expense: { ...exp('b', 300, 'other'), category: 'rent' as never } });
    expect(s.days[D].expenses.map((e) => e.category)).toEqual(['other', 'food']);
  });

  test('stored expenses from 1.2, with no category, read back as "other"', () => {
    const d = sanitizeDay({ expenses: [{ id: 'old', cents: 250, label: 'Coffee', createdAt: 1 }, { id: 'n', cents: 1, category: 'fun', createdAt: 1 }] });
    expect(d.expenses.map((e) => e.category)).toEqual(['other', 'fun']);
    expect(isCategory('__proto__')).toBe(false);
  });

  test('a 1.2 backup restores, with its expenses filed under "other"', () => {
    const text = JSON.stringify({
      app: 'Personal Daily Hub',
      format: 1,
      days: { '2026-11-01': { expenses: [{ id: 'x', cents: 999, label: 'Gift', createdAt: 5 }] } },
    });
    const parsed = parseBackup(text, new Date(2026, 10, 8));
    expect(parsed.ok && parsed.backup.days['2026-11-01'].expenses[0].category).toBe('other');
  });

  test('totals per category, largest first, ties in the fixed order', () => {
    expect(
      categoryTotals([exp('a', 300, 'fun'), exp('b', 500, 'food'), exp('c', 200, 'fun'), exp('d', 500, 'bills')]),
    ).toEqual([
      { category: 'food', cents: 500 },
      { category: 'bills', cents: 500 },
      { category: 'fun', cents: 500 },
    ]);
    expect(categoryTotals([])).toEqual([]);
  });

  test('an unlabelled expense is called by its category', () => {
    expect(expenseName(exp('a', 1, 'food'))).toBe('Food');
    expect(expenseName(exp('a', 1, 'other'))).toBe('Expense');
    expect(expenseName(exp('a', 1, 'food', 'Tacos'))).toBe('Tacos');
  });

  test('the weekly summary names where most money went', () => {
    const s = weekSummary(
      [{ log: day({ expenses: [exp('a', 1200, 'food'), exp('b', 3000, 'bills')] }) }, { log: day({ expenses: [exp('c', 2500, 'food')] }) }],
      [],
    );
    expect(s.topCategory).toEqual({ category: 'food', cents: 3700 });
  });
});

describe('daily budget', () => {
  test('steps through fixed amounts, off below the first and capped at the last', () => {
    expect(stepBudget(null, 1)).toBe(1000);
    expect(stepBudget(1000, -1)).toBeNull();
    expect(stepBudget(null, -1)).toBeNull();
    expect(stepBudget(4000, 1)).toBe(5000);
    expect(stepBudget(4000, -1)).toBe(3000);
    expect(stepBudget(4200, 1)).toBe(5000); // between steps: to the next one that way
    expect(stepBudget(4200, -1)).toBe(4000);
    const top = BUDGET_STEPS_CENTS[BUDGET_STEPS_CENTS.length - 1];
    expect(stepBudget(top, 1)).toBe(top);
  });

  test('settings accept only a budget in range, and default to none', () => {
    expect(sanitizeSettings({}).dailyBudgetCents).toBeNull();
    expect(sanitizeSettings({ dailyBudgetCents: 2500 }).dailyBudgetCents).toBe(2500);
    for (const bad of [-1, 0, 99, 12.5, '2500', 10_000_000]) {
      expect(sanitizeSettings({ dailyBudgetCents: bad }).dailyBudgetCents).toBeNull();
    }
    let s = reducer(initialState, { type: 'updateSettings', patch: { dailyBudgetCents: 4000 } });
    expect(s.settings.dailyBudgetCents).toBe(4000);
    s = reducer(s, { type: 'updateSettings', patch: { dailyBudgetCents: -5 } });
    expect(s.settings.dailyBudgetCents).toBeNull();
  });
});

describe('search', () => {
  const days: Record<string, DayLog> = {
    '2026-11-01': day({
      focus: 'Café opening',
      notes: [
        { id: 'n1', text: 'Call the dentist', createdAt: 100 },
        { id: 'n2', text: 'Dentist moved to Friday', createdAt: 200 },
      ],
      expenses: [exp('e1', 500, 'food', 'Cafe latte'), exp('e2', 300, 'food')],
    }),
    '2026-11-07': day({ notes: [{ id: 'n3', text: 'DENTIST bill paid', createdAt: 300 }] }),
  };

  test('finds notes in any case, newest day and entry first', () => {
    const { hits, total } = searchDays(days, 'dentist');
    expect(total).toBe(3);
    expect(hits.map((h) => h.id)).toEqual(['n3', 'n2', 'n1']);
    expect(hits[0]).toMatchObject({ start: 0, length: 7 });
    expect(hits[2].text.slice(hits[2].start, hits[2].start + hits[2].length)).toBe('dentist');
  });

  test('ignores accents both ways, and searches the focus and expense labels', () => {
    const { hits } = searchDays(days, 'cafe');
    expect(hits.map((h) => h.kind)).toEqual(['focus', 'expense']);
    expect(hits[0].text.slice(hits[0].start, hits[0].start + hits[0].length)).toBe('Café');
    expect(searchDays(days, 'CAFÉ').total).toBe(2);
  });

  test('an empty query finds nothing, and results are capped with the full count kept', () => {
    expect(searchDays(days, '   ').total).toBe(0);
    const many: Record<string, DayLog> = {
      [D]: day({ notes: Array.from({ length: 150 }, (_, i) => ({ id: `n${i}`, text: `note ${i}`, createdAt: i + 1 })) }),
    };
    const r = searchDays(many, 'note');
    expect(r.total).toBe(150);
    expect(r.hits).toHaveLength(100);
    expect(r.hits[0].id).toBe('n149');
  });
});

describe('month calendar shading', () => {
  test('steps from none to all habits done', () => {
    expect([0, 1, 2, 3, 4].map((n) => habitLevel(n, 4))).toEqual([0, 1, 2, 3, 4]);
    expect([0, 1, 2, 3, 4, 5].map((n) => habitLevel(n, 5))).toEqual([0, 1, 2, 2, 3, 4]);
    expect(habitLevel(3, 0)).toBe(0);
  });
});

describe('erasing storage', () => {
  test('removes every app key, quarantined copies included, and nothing else', async () => {
    await AsyncStorage.multiSet([
      ['pdh:v1:day:2026-11-08', 'x'],
      ['pdh:v1:habits', 'x'],
      ['pdh:v1:settings', 'x'],
      ['pdh:v1:corrupt:1:pdh:v1:day:2026-11-01', 'x'],
      ['some-other-library', 'keep me'],
    ]);
    expect(await eraseStoredData()).toBe(4);
    expect(await AsyncStorage.getAllKeys()).toEqual(['some-other-library']);
  });

  test('the persister can drop queued writes, and a failed write is not retried after', async () => {
    const p = createPersister({ delayMs: 10 });
    p.schedule('pdh:v1:a', 1);
    await p.discard();
    await new Promise((r) => setTimeout(r, 30));
    await p.flush();
    expect(await AsyncStorage.getItem('pdh:v1:a')).toBeNull();

    // A write already under way when the discard comes, which then fails,
    // must not be queued again: it would land after the erase.
    let fail: ((e: Error) => void) | undefined;
    // Once only, and not restored: the AsyncStorage mock's own functions are
    // jest.fn()s, and restoring a spy on one would blank its implementation.
    (AsyncStorage.multiSet as jest.Mock).mockImplementationOnce(
      () => new Promise<void>((_, reject) => (fail = reject)),
    );
    p.schedule('pdh:v1:b', 2);
    const inFlight = p.flush();
    while (!fail) await new Promise((r) => setTimeout(r, 1));
    const drained = p.discard();
    fail(new Error('disk full'));
    await inFlight;
    await drained;
    await p.flush();
    p.schedule('pdh:v1:c', 3); // and the persister still works afterwards
    await p.flush();
    expect(await AsyncStorage.getItem('pdh:v1:c')).toBe('3');
    expect(await AsyncStorage.getItem('pdh:v1:b')).toBeNull();
  });
});
