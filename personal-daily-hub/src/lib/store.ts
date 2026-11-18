// State shape and every way it can change. Pure: no React, no storage, no
// clock — the date and timestamps arrive in the actions — so it is tested
// directly.

import { CATEGORY_LABELS, DEFAULT_CATEGORY, isBudget, isCategory, type ExpenseCategory } from './categories';
import { lastNDays } from './date';
//
// Daily data is keyed by local date string, so "today" starts empty each
// morning while every earlier day stays where it was:
//
//   {
//     habits: [ { id, label, core } ],            // definitions, carried across days
//     days: {
//       '2026-11-07': { focus, notes, habitsDone, water, energy, mood, expenses },
//       '2026-11-08': { ... },                     // today
//     },
//   }

export type Note = { id: string; text: string; createdAt: number; editedAt?: number };
export type Expense = { id: string; cents: number; label: string; category: ExpenseCategory; createdAt: number };
export type Habit = { id: string; label: string; core: boolean };

export type DayLog = {
  focus: string; // the one thing that matters today; '' until set
  notes: Note[]; // newest first
  habitsDone: string[]; // ids of habits ticked that day
  water: number; // glasses
  energy: number | null; // 1–10, null until logged
  mood: number | null; // 1–5, null until logged
  expenses: Expense[]; // newest first
};

export type Settings = {
  waterGoal: number; // glasses a day
  reminderHour: number; // local hour of the daily reminder, 24h
  lockEnabled: boolean; // require fingerprint / face / PIN to open
  haptics: boolean; // a light tap of feedback on ticks, steps and saves
  dailyBudgetCents: number | null; // spending limit for a day; null = no budget
};

export type HubState = {
  habits: Habit[];
  days: Record<string, DayLog>;
  settings: Settings;
};

export const WATER_GOAL_MIN = 4;
export const WATER_GOAL_MAX = 16;
export const REMINDER_HOUR_MIN = 6;
export const REMINDER_HOUR_MAX = 23;
export const DEFAULT_SETTINGS: Settings = Object.freeze({
  waterGoal: 8,
  reminderHour: 20,
  lockEnabled: false,
  haptics: true,
  dailyBudgetCents: null,
});

export const WATER_MAX = 20;
export const ENERGY_MIN = 1;
export const ENERGY_MAX = 10;
export const MOOD_MIN = 1;
export const MOOD_MAX = 5;
export const NOTE_MAX_LENGTH = 500;
export const FOCUS_MAX_LENGTH = 120;
export const HABIT_MAX_LENGTH = 60;
export const EXPENSE_LABEL_MAX_LENGTH = 40;
export const CUSTOM_HABITS_MAX = 20;

export const CORE_HABITS: readonly Habit[] = [
  { id: 'core-move', label: 'Move for 30 minutes', core: true },
  { id: 'core-read', label: 'Read 20 pages', core: true },
  { id: 'core-mindful', label: 'Meditate for 10 minutes', core: true },
  { id: 'core-plan', label: 'Plan tomorrow', core: true },
];

export const EMPTY_DAY: DayLog = Object.freeze({
  focus: '',
  notes: [],
  habitsDone: [],
  water: 0,
  energy: null,
  mood: null,
  expenses: [],
}) as DayLog;

export const initialState: HubState = { habits: [...CORE_HABITS], days: {}, settings: DEFAULT_SETTINGS };

export type Action =
  | { type: 'hydrate'; habits: Habit[]; days: Record<string, DayLog>; settings: Settings }
  | { type: 'updateSettings'; patch: Partial<Settings> }
  | { type: 'restoreNote'; date: string; note: Note }
  | { type: 'restoreExpense'; date: string; expense: Expense }
  | { type: 'restoreHabit'; date: string; habit: Habit; index: number; wasDone: boolean }
  | { type: 'mergeDays'; days: Record<string, DayLog> }
  | { type: 'addNote'; date: string; note: Note }
  | { type: 'deleteNote'; date: string; id: string }
  | { type: 'toggleHabit'; date: string; id: string }
  | { type: 'addHabit'; habit: Habit }
  | { type: 'removeHabit'; date: string; id: string }
  | { type: 'adjustWater'; date: string; delta: number }
  | { type: 'setEnergy'; date: string; value: number }
  | { type: 'setMood'; date: string; value: number | null }
  | { type: 'setFocus'; date: string; text: string }
  | { type: 'editNote'; date: string; id: string; text: string; now: number }
  | { type: 'importBackup'; habits: Habit[]; days: Record<string, DayLog> }
  | { type: 'addExpense'; date: string; expense: Expense }
  | { type: 'deleteExpense'; date: string; id: string };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function getDay(state: HubState, date: string): DayLog {
  return state.days[date] ?? EMPTY_DAY;
}

function updateDay(state: HubState, date: string, fn: (day: DayLog) => DayLog): HubState {
  const before = getDay(state, date);
  const after = fn(before);
  if (after === before) return state;
  return { ...state, days: { ...state.days, [date]: after } };
}

export function reducer(state: HubState, action: Action): HubState {
  switch (action.type) {
    case 'hydrate':
      return { habits: action.habits, days: action.days, settings: action.settings };

    case 'updateSettings': {
      const p = action.patch;
      const cur = state.settings;
      const next: Settings = {
        waterGoal: p.waterGoal === undefined ? cur.waterGoal : clamp(Math.round(p.waterGoal), WATER_GOAL_MIN, WATER_GOAL_MAX),
        reminderHour:
          p.reminderHour === undefined
            ? cur.reminderHour
            : clamp(Math.round(p.reminderHour), REMINDER_HOUR_MIN, REMINDER_HOUR_MAX),
        lockEnabled: p.lockEnabled === undefined ? cur.lockEnabled : p.lockEnabled === true,
        haptics: p.haptics === undefined ? cur.haptics : p.haptics === true,
        dailyBudgetCents:
          p.dailyBudgetCents === undefined
            ? cur.dailyBudgetCents
            : isBudget(p.dailyBudgetCents)
              ? p.dailyBudgetCents
              : null,
      };
      const same =
        next.waterGoal === cur.waterGoal &&
        next.reminderHour === cur.reminderHour &&
        next.lockEnabled === cur.lockEnabled &&
        next.haptics === cur.haptics &&
        next.dailyBudgetCents === cur.dailyBudgetCents;
      return same ? state : { ...state, settings: next };
    }

    // Undo: put a deleted item back where it was. Lists are newest first, so
    // it goes back by timestamp, not to the top.
    case 'restoreNote':
      return updateDay(state, action.date, (d) =>
        d.notes.some((n) => n.id === action.note.id)
          ? d
          : { ...d, notes: insertByTime(d.notes, action.note) },
      );

    case 'restoreExpense':
      return updateDay(state, action.date, (d) =>
        d.expenses.some((e) => e.id === action.expense.id)
          ? d
          : { ...d, expenses: insertByTime(d.expenses, action.expense) },
      );

    case 'restoreHabit': {
      if (state.habits.some((h) => h.id === action.habit.id)) return state;
      const habits = [...state.habits];
      habits.splice(clamp(action.index, CORE_HABITS.length, habits.length), 0, action.habit);
      const next = { ...state, habits };
      return action.wasDone
        ? updateDay(next, action.date, (d) => ({ ...d, habitsDone: [...d.habitsDone, action.habit.id] }))
        : next;
    }

    case 'mergeDays': {
      // Days already in memory win: they are at least as new as storage.
      const days = { ...action.days, ...state.days };
      return { ...state, days };
    }

    case 'addNote': {
      const text = action.note.text.trim().slice(0, NOTE_MAX_LENGTH);
      if (!text) return state;
      return updateDay(state, action.date, (d) => ({
        ...d,
        notes: [{ ...action.note, text }, ...d.notes],
      }));
    }

    case 'editNote': {
      const text = action.text.trim().slice(0, NOTE_MAX_LENGTH);
      if (!text) return state; // emptying a note is a delete, not an edit
      return updateDay(state, action.date, (d) => {
        const i = d.notes.findIndex((n) => n.id === action.id);
        if (i === -1 || d.notes[i].text === text) return d;
        const notes = [...d.notes];
        notes[i] = { ...notes[i], text, editedAt: action.now };
        return { ...d, notes };
      });
    }

    case 'deleteNote':
      return updateDay(state, action.date, (d) => {
        const notes = d.notes.filter((n) => n.id !== action.id);
        return notes.length === d.notes.length ? d : { ...d, notes };
      });

    case 'toggleHabit': {
      if (!state.habits.some((h) => h.id === action.id)) return state;
      return updateDay(state, action.date, (d) => ({
        ...d,
        habitsDone: d.habitsDone.includes(action.id)
          ? d.habitsDone.filter((id) => id !== action.id)
          : [...d.habitsDone, action.id],
      }));
    }

    case 'addHabit': {
      const label = action.habit.label.trim().slice(0, HABIT_MAX_LENGTH);
      const customCount = state.habits.filter((h) => !h.core).length;
      if (!label || customCount >= CUSTOM_HABITS_MAX) return state;
      if (state.habits.some((h) => h.label.toLowerCase() === label.toLowerCase())) return state;
      return { ...state, habits: [...state.habits, { ...action.habit, label, core: false }] };
    }

    case 'removeHabit': {
      const habit = state.habits.find((h) => h.id === action.id);
      if (!habit || habit.core) return state; // the four core habits stay
      const next = { ...state, habits: state.habits.filter((h) => h.id !== action.id) };
      // Untick it today. Earlier days keep their record of having done it.
      return updateDay(next, action.date, (d) =>
        d.habitsDone.includes(action.id)
          ? { ...d, habitsDone: d.habitsDone.filter((id) => id !== action.id) }
          : d,
      );
    }

    case 'adjustWater':
      return updateDay(state, action.date, (d) => {
        const water = clamp(d.water + action.delta, 0, WATER_MAX);
        return water === d.water ? d : { ...d, water };
      });

    case 'setEnergy':
      return updateDay(state, action.date, (d) => {
        const energy = clamp(Math.round(action.value), ENERGY_MIN, ENERGY_MAX);
        return energy === d.energy ? d : { ...d, energy };
      });

    case 'setMood':
      return updateDay(state, action.date, (d) => {
        const mood = action.value === null ? null : clamp(Math.round(action.value), MOOD_MIN, MOOD_MAX);
        return mood === d.mood ? d : { ...d, mood };
      });

    case 'setFocus': {
      const focus = cleanFocus(action.text);
      return updateDay(state, action.date, (d) => (focus === d.focus ? d : { ...d, focus }));
    }

    case 'importBackup':
      return mergeBackup(state, action.habits, action.days).state;

    case 'addExpense': {
      const { cents } = action.expense;
      if (!Number.isInteger(cents) || cents <= 0) return state;
      const label = action.expense.label.trim().slice(0, EXPENSE_LABEL_MAX_LENGTH);
      const category = isCategory(action.expense.category) ? action.expense.category : DEFAULT_CATEGORY;
      return updateDay(state, action.date, (d) => ({
        ...d,
        expenses: [{ ...action.expense, label, category }, ...d.expenses],
      }));
    }

    case 'deleteExpense':
      return updateDay(state, action.date, (d) => {
        const expenses = d.expenses.filter((e) => e.id !== action.id);
        return expenses.length === d.expenses.length ? d : { ...d, expenses };
      });

    default:
      return state;
  }
}

export type MergeStats = {
  daysAdded: number; // dates the phone had nothing for
  daysMerged: number; // dates both had; the phone's entries are kept
  notesAdded: number;
  expensesAdded: number;
  habitsAdded: number;
};

const byNewest = <T extends { createdAt: number }>(a: T, b: T) => b.createdAt - a.createdAt;

function unionById<T extends { id: string; createdAt: number }>(mine: T[], theirs: T[]): { list: T[]; added: number } {
  const have = new Set(mine.map((x) => x.id));
  const extra = theirs.filter((x) => !have.has(x.id));
  return extra.length === 0 ? { list: mine, added: 0 } : { list: [...mine, ...extra].sort(byNewest), added: extra.length };
}

/**
 * Folds a restored backup into what is on the phone. Nothing on the phone
 * is ever overwritten or removed: where both have a value, the phone's
 * wins; notes and expenses are combined by id; habit ticks are combined;
 * water takes the larger count. Restoring the same file twice changes
 * nothing the second time. The input must already be sanitized.
 */
export function mergeBackup(
  state: HubState,
  habits: Habit[],
  days: Record<string, DayLog>,
): { state: HubState; stats: MergeStats } {
  const stats: MergeStats = { daysAdded: 0, daysMerged: 0, notesAdded: 0, expensesAdded: 0, habitsAdded: 0 };

  let nextHabits = state.habits;
  for (const h of habits) {
    const custom = nextHabits.filter((x) => !x.core).length;
    const clash = nextHabits.some((x) => x.id === h.id || x.label.toLowerCase() === h.label.toLowerCase());
    if (h.core || clash || custom >= CUSTOM_HABITS_MAX) continue;
    nextHabits = [...nextHabits, { ...h, core: false }];
    stats.habitsAdded++;
  }

  let nextDays = state.days;
  for (const [date, theirs] of Object.entries(days)) {
    const mine = state.days[date];
    let merged: DayLog;
    if (!mine) {
      merged = theirs;
      stats.daysAdded++;
      stats.notesAdded += theirs.notes.length;
      stats.expensesAdded += theirs.expenses.length;
    } else {
      const notes = unionById(mine.notes, theirs.notes);
      const expenses = unionById(mine.expenses, theirs.expenses);
      const habitsDone = [...new Set([...mine.habitsDone, ...theirs.habitsDone])];
      const candidate: DayLog = {
        focus: mine.focus || theirs.focus,
        notes: notes.list,
        expenses: expenses.list,
        habitsDone: habitsDone.length === mine.habitsDone.length ? mine.habitsDone : habitsDone,
        water: Math.max(mine.water, theirs.water),
        energy: mine.energy ?? theirs.energy,
        mood: mine.mood ?? theirs.mood,
      };
      const changed =
        candidate.focus !== mine.focus ||
        candidate.notes !== mine.notes ||
        candidate.expenses !== mine.expenses ||
        candidate.habitsDone !== mine.habitsDone ||
        candidate.water !== mine.water ||
        candidate.energy !== mine.energy ||
        candidate.mood !== mine.mood;
      if (!changed) continue;
      merged = candidate;
      stats.daysMerged++;
      stats.notesAdded += notes.added;
      stats.expensesAdded += expenses.added;
    }
    if (nextDays === state.days) nextDays = { ...state.days };
    nextDays[date] = merged;
  }

  const unchanged = nextHabits === state.habits && nextDays === state.days;
  return { state: unchanged ? state : { ...state, habits: nextHabits, days: nextDays }, stats };
}

/** One line, trimmed, capped. Clearing the text clears the focus. */
export function cleanFocus(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, FOCUS_MAX_LENGTH);
}

function insertByTime<T extends { createdAt: number }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.createdAt < item.createdAt);
  return i === -1 ? [...list, item] : [...list.slice(0, i), item, ...list.slice(i)];
}

// ---- selectors ------------------------------------------------------------

/**
 * Days in a row the habit was done, counting back from today — or from
 * yesterday if it is not ticked yet today, so a streak is not shown as
 * broken while there is still time to keep it. Stops at `maxDays`, the
 * history the app has loaded.
 */
export function habitStreak(state: HubState, habitId: string, today: string, maxDays: number): number {
  const days = lastNDays(today, maxDays + 1).reverse(); // today first
  const doneOn = (date: string) => state.days[date]?.habitsDone.includes(habitId) ?? false;
  let i = doneOn(days[0]) ? 0 : 1;
  let streak = 0;
  while (i < days.length && streak < maxDays && doneOn(days[i])) {
    streak++;
    i++;
  }
  return streak;
}

/** What an expense is called: its label, else its category ("Expense" for other). */
export function expenseName(e: Expense): string {
  return e.label || (e.category === DEFAULT_CATEGORY ? 'Expense' : CATEGORY_LABELS[e.category]);
}

export function totalCents(day: DayLog): number {
  return day.expenses.reduce((sum, e) => sum + e.cents, 0);
}

/** Ticked habits that still exist — a removed habit's old tick doesn't count. */
export function habitsDoneCount(state: HubState, day: DayLog): number {
  return state.habits.filter((h) => day.habitsDone.includes(h.id)).length;
}

export function hasAnyData(day: DayLog): boolean {
  return (
    day.focus !== '' ||
    day.notes.length > 0 ||
    day.habitsDone.length > 0 ||
    day.water > 0 ||
    day.energy !== null ||
    day.mood !== null ||
    day.expenses.length > 0
  );
}

let counter = 0;
/** Unique enough for local records: time, a counter, and a random tail. */
export function newId(prefix: string): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}
