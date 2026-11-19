import { journalPrompt } from '../src/components/Journal';
import { lastNDays, weekdaysLabel } from '../src/lib/date';
import { searchDays } from '../src/lib/search';
import { habitsForStorage, sanitizeDay, sanitizeHabits, sanitizeSettings } from '../src/lib/storage';
import {
  CORE_HABITS,
  EMPTY_DAY,
  habitStreak,
  hasAnyData,
  initialState,
  isScheduled,
  JOURNAL_MAX_LENGTH,
  mergeBackup,
  recentExpenses,
  reducer,
  type DayLog,
  type Expense,
  type HubState,
} from '../src/lib/store';
import { monthSummary, weekSummary } from '../src/lib/summary';

// 2026-11-18 is a Wednesday.
const WED = '2026-11-18';
const day = (over: Partial<DayLog>): DayLog => ({ ...EMPTY_DAY, ...over });
const ago = (n: number) => lastNDays(WED, n + 1)[0];
const exp = (id: string, cents: number, label: string, category: Expense['category'] = 'food'): Expense => ({
  id,
  cents,
  label,
  category,
  createdAt: 1,
});

describe('habit schedules', () => {
  test('days are normalized; all seven is every day; none is refused', () => {
    let s = reducer(initialState, { type: 'setHabitDays', id: 'core-move', days: [5, 1, 3, 3, 9, -1] });
    expect(s.habits.find((h) => h.id === 'core-move')?.days).toEqual([1, 3, 5]);
    expect(reducer(s, { type: 'setHabitDays', id: 'core-move', days: [3, 1, 5] })).toBe(s);
    expect(reducer(s, { type: 'setHabitDays', id: 'core-move', days: [] })).toBe(s);
    expect(reducer(s, { type: 'setHabitDays', id: 'nope', days: [1] })).toBe(s);
    s = reducer(s, { type: 'setHabitDays', id: 'core-move', days: [0, 1, 2, 3, 4, 5, 6] });
    expect(s.habits.find((h) => h.id === 'core-move')).toEqual(CORE_HABITS[0]);
    s = reducer(s, { type: 'setHabitDays', id: 'core-move', days: [2] });
    s = reducer(s, { type: 'setHabitDays', id: 'core-move', days: null });
    expect(s.habits.find((h) => h.id === 'core-move')).not.toHaveProperty('days');
  });

  test('a habit is due only on its weekdays', () => {
    expect(isScheduled({ days: [3] }, WED)).toBe(true);
    expect(isScheduled({ days: [1, 5] }, WED)).toBe(false);
    expect(isScheduled({}, WED)).toBe(true);
    expect(weekdaysLabel([5, 1, 3])).toBe('Mon, Wed, Fri');
    expect(weekdaysLabel([1, 2, 3, 4, 5])).toBe('Weekdays');
    expect(weekdaysLabel([6, 0])).toBe('Weekends');
  });

  test('streaks step over days off: they neither count nor break it', () => {
    // Mon/Wed/Fri. Done on the last three of those; the days between are off.
    const habits = [{ id: 'h', label: 'Gym', core: false, days: [1, 3, 5] }];
    const days = { [ago(5)]: day({ habitsDone: ['h'] }), [ago(2)]: day({ habitsDone: ['h'] }), [WED]: day({ habitsDone: ['h'] }) };
    const s: HubState = { ...initialState, habits, days };
    expect(habitStreak(s, 'h', WED, 60)).toBe(3); // Fri, Mon, Wed
    // Not ticked yet today: still 2, counting from Monday.
    const notYet: HubState = { ...s, days: { ...days, [WED]: day({}) } };
    expect(habitStreak(notYet, 'h', WED, 60)).toBe(2);
    // A missed Monday breaks it.
    const missed: HubState = { ...s, days: { ...days, [ago(2)]: day({}) } };
    expect(habitStreak(missed, 'h', WED, 60)).toBe(1);
    // Tomorrow (Thursday) is off: the streak still stands.
    expect(habitStreak(s, 'h', '2026-11-19', 60)).toBe(3);
  });

  test('summaries count a habit only on the days it is due', () => {
    const habits = [
      { id: 'daily', days: undefined },
      { id: 'wed', days: [3] },
    ];
    const week = [
      { date: ago(1), log: day({ habitsDone: ['daily', 'wed'] }) }, // Tuesday: "wed" not due, so not counted
      { date: WED, log: day({ habitsDone: ['wed'] }) },
    ];
    expect(weekSummary(week, habits).habitRate).toBeCloseTo(2 / 3); // due: daily ×2, wed ×1; done: daily Tue, wed Wed
    const days = { [ago(1)]: week[0].log, [WED]: week[1].log };
    expect(monthSummary(days, [ago(1), WED], habits).habitRate).toBeCloseTo(2 / 3);
  });

  test('stored: a core habit keeps only its schedule; a custom one keeps everything', () => {
    let s = reducer(initialState, { type: 'setHabitDays', id: 'core-read', days: [1, 2] });
    s = reducer(s, { type: 'addHabit', habit: { id: 'c1', label: 'Stretch', core: false } });
    s = reducer(s, { type: 'setHabitDays', id: 'c1', days: [6] });
    const stored = habitsForStorage(s.habits);
    expect(stored).toEqual([
      { id: 'core-read', core: true, days: [1, 2] },
      { id: 'c1', label: 'Stretch', core: false, days: [6] },
    ]);
    expect(sanitizeHabits(JSON.parse(JSON.stringify(stored)))).toEqual(s.habits);
  });

  test('stored schedules are checked: bad ones mean every day, and core names cannot be changed', () => {
    const habits = sanitizeHabits([
      { id: 'core-move', core: true, days: [1], label: 'Renamed!' },
      { id: 'core-plan', core: true, days: [] },
      { id: 'c1', label: 'Walk', days: ['mon', 9] },
      { id: 'c2', label: 'Swim', days: [0, 1, 2, 3, 4, 5, 6] },
      { id: 'core-fake', core: true, days: [2] },
    ]);
    expect(habits.find((h) => h.id === 'core-move')).toEqual({ ...CORE_HABITS[0], days: [1] });
    expect(habits.find((h) => h.id === 'core-plan')).toEqual(CORE_HABITS[3]);
    expect(habits.find((h) => h.id === 'c1')).toEqual({ id: 'c1', label: 'Walk', core: false });
    expect(habits.find((h) => h.id === 'c2')).toEqual({ id: 'c2', label: 'Swim', core: false });
    expect(habits.some((h) => h.id === 'core-fake')).toBe(false);
  });
});

describe('journal', () => {
  test('keeps line breaks, trims the ends, caps the length; clearing clears', () => {
    let s = reducer(initialState, { type: 'setJournal', date: WED, text: '  Good day.\r\nLong walk.  ' });
    expect(s.days[WED].journal).toBe('Good day.\nLong walk.');
    expect(hasAnyData(s.days[WED])).toBe(true);
    s = reducer(s, { type: 'setJournal', date: WED, text: 'x'.repeat(5000) });
    expect(s.days[WED].journal).toHaveLength(JOURNAL_MAX_LENGTH);
    s = reducer(s, { type: 'setJournal', date: WED, text: '   ' });
    expect(s.days[WED].journal).toBe('');
  });

  test('is sanitized on the way in, and a restore keeps the phone’s entry', () => {
    expect(sanitizeDay({ journal: 7 }).journal).toBe('');
    expect(sanitizeDay({ journal: 'a\r\nb' }).journal).toBe('a\nb');
    expect(sanitizeDay({ journal: 'z'.repeat(9000) }).journal).toHaveLength(JOURNAL_MAX_LENGTH);
    const s: HubState = { ...initialState, days: { [WED]: day({ journal: 'Mine' }), [ago(1)]: day({ water: 1 }) } };
    const { state } = mergeBackup(s, [], { [WED]: day({ journal: 'Theirs' }), [ago(1)]: day({ journal: 'Filled in' }) });
    expect(state.days[WED].journal).toBe('Mine');
    expect(state.days[ago(1)].journal).toBe('Filled in');
  });

  test('search finds a journal entry and shows the match in context', () => {
    const journal = `${'Morning routine went fine. '.repeat(4)}Then I finally called grandma about the trip.${' More.'.repeat(30)}`;
    const { hits } = searchDays({ [WED]: day({ journal }) }, 'grandma');
    expect(hits).toHaveLength(1);
    const h = hits[0];
    expect(h.kind).toBe('journal');
    expect(h.text.startsWith('…')).toBe(true);
    expect(h.text.endsWith('…')).toBe(true);
    expect(h.text.slice(h.start, h.start + h.length)).toBe('grandma');
    expect(h.text.length).toBeLessThan(140);
  });

  test('a different prompt each weekday', () => {
    expect(journalPrompt(WED)).toBe('What was harder than it should have been?');
    expect(new Set(lastNDays(WED, 7).map(journalPrompt)).size).toBe(7);
  });
});

describe('recent expenses', () => {
  test('distinct by label, amount and category; most recent first; at most six; two weeks back', () => {
    const s: HubState = {
      ...initialState,
      days: {
        [WED]: day({ expenses: [exp('a', 450, 'Coffee')] }),
        [ago(1)]: day({ expenses: [exp('b', 450, 'coffee '), exp('c', 450, 'Coffee', 'other'), exp('d', 1200, 'Lunch')] }),
        [ago(3)]: day({ expenses: ['A', 'B', 'C', 'D'].map((l, i) => exp(`e${i}`, 100 + i, l)) }),
        [ago(20)]: day({ expenses: [exp('old', 999, 'Too old')] }),
      },
    };
    expect(recentExpenses(s, WED).map((e) => e.id)).toEqual(['a', 'c', 'd', 'e0', 'e1', 'e2']);
  });
});

describe('hide amounts', () => {
  test('a setting, off by default', () => {
    expect(sanitizeSettings({}).hideAmounts).toBe(false);
    expect(sanitizeSettings({ hideAmounts: true }).hideAmounts).toBe(true);
    expect(sanitizeSettings({ hideAmounts: 'yes' }).hideAmounts).toBe(false);
    const s = reducer(initialState, { type: 'updateSettings', patch: { hideAmounts: true } });
    expect(s.settings.hideAmounts).toBe(true);
  });
});
