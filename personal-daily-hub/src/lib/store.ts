// State shape and every way it can change. Pure: no React, no storage, no
// clock — the date and timestamps arrive in the actions — so it is tested
// directly.

import { CATEGORY_LABELS, DEFAULT_CATEGORY, isBudget, isCategory, type ExpenseCategory } from './categories';
import { lastNDays, parseDateKey } from './date';
//
// Daily data is keyed by local date string, so "today" starts empty each
// morning while every earlier day stays where it was:
//
//   {
//     habits: [ { id, label, core, days? } ],     // definitions in the order shown, carried across days
//     days: {
//       '2026-11-07': { focus, journal, notes, habitsDone, habitsSkipped, water, energy, mood, sleep,
//                       expenses, focusMinutes },
//       '2026-11-08': { ... },                     // today
//     },
//   }

export type Note = {
  id: string;
  text: string;
  createdAt: number;
  editedAt?: number;
  /** A to-do rather than a plain note: it can be ticked off. */
  task?: true;
  /** When the to-do was ticked off. */
  doneAt?: number;
  /** The day this to-do was brought over from. */
  carriedFrom?: string;
  /** The day an unfinished to-do was brought over to; it then lives there. */
  carriedTo?: string;
};
export type Expense = { id: string; cents: number; label: string; category: ExpenseCategory; createdAt: number };
export type Habit = {
  id: string;
  label: string;
  core: boolean;
  /** Weekdays it is meant for (0 = Sunday … 6 = Saturday), sorted. Absent = every day. */
  days?: number[];
};

export type DayLog = {
  focus: string; // the one thing that matters today; '' until set
  journal: string; // a few lines at the end of the day; '' until written
  notes: Note[]; // newest first
  habitsDone: string[]; // ids of habits ticked that day
  habitsSkipped: string[]; // ids of habits set aside that day: they neither count nor break a streak
  water: number; // glasses
  energy: number | null; // 1–10, null until logged
  mood: number | null; // 1–5, null until logged
  sleep: number | null; // hours slept the night before, in half hours; null until logged
  expenses: Expense[]; // newest first
  focusMinutes: number; // minutes of focus sessions finished that day
};

export type Settings = {
  waterGoal: number; // glasses a day
  reminderHour: number; // local hour of the daily reminder, 24h
  lockEnabled: boolean; // require fingerprint / face / PIN to open
  haptics: boolean; // a light tap of feedback on ticks, steps and saves
  dailyBudgetCents: number | null; // spending limit for a day; null = no budget
  relockAfterSec: number; // with app lock on: time in the background before it locks again
  hideAmounts: boolean; // show every amount of money as "$•••", for using the app in company
  focusLength: number; // minutes in one focus session
  homeOrder: HomeCard[]; // the home screen's cards, top to bottom
  homeHidden: HomeCard[]; // cards switched off on the home screen
};

/** The cards on the home screen, in their default order. */
export const HOME_CARDS = [
  'focus',
  'notes',
  'habits',
  'wellbeing',
  'expenses',
  'journal',
  'countdowns',
  'insights',
  'history',
] as const;
export type HomeCard = (typeof HOME_CARDS)[number];
export const isHomeCard = (v: unknown): v is HomeCard => typeof v === 'string' && (HOME_CARDS as readonly string[]).includes(v);

/** A focus session that is running: it belongs to the day it was started on. */
export type FocusTimer = { date: string; startedAt: number; endsAt: number };

/** A date worth counting down to. */
export type Countdown = { id: string; label: string; date: string };

export type HubState = {
  habits: Habit[];
  days: Record<string, DayLog>;
  settings: Settings;
  countdowns: Countdown[]; // soonest first
  focusTimer: FocusTimer | null; // the focus session under way, if any
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
  relockAfterSec: 30,
  hideAmounts: false,
  focusLength: 25,
  homeOrder: [...HOME_CARDS],
  homeHidden: [],
});

/** The lengths a focus session can be set to, in minutes. */
export const FOCUS_LENGTHS: readonly number[] = [15, 25, 45, 60];
/** No day holds more focus than it has minutes. */
export const FOCUS_MINUTES_MAX = 24 * 60;

/** The choices for how long the app may sit in the background before locking again. */
export const RELOCK_CHOICES_SEC: readonly number[] = [0, 30, 60, 300];

export const WATER_MAX = 20;
export const ENERGY_MIN = 1;
export const ENERGY_MAX = 10;
export const MOOD_MIN = 1;
export const MOOD_MAX = 5;
export const SLEEP_MAX = 14;
export const SLEEP_STEP = 0.5;
/** Where the sleep stepper starts the first time it is pressed. */
export const SLEEP_START = 7;
/** Streak lengths worth a word of congratulations. */
export const STREAK_MILESTONES: readonly number[] = [3, 7, 14, 30, 60];
/** How far back a forgotten day can still be filled in from the home screen. */
export const EDITABLE_DAYS = 7;
/** How far back unfinished to-dos are offered to bring over to today. */
export const CARRY_LOOKBACK_DAYS = 7;
export const NOTE_MAX_LENGTH = 500;
export const FOCUS_MAX_LENGTH = 120;
export const JOURNAL_MAX_LENGTH = 2000;
/** How far back recent expenses are offered to add again. */
export const RECENT_EXPENSE_DAYS = 14;
export const RECENT_EXPENSES_MAX = 6;
export const HABIT_MAX_LENGTH = 60;
export const EXPENSE_LABEL_MAX_LENGTH = 40;
export const CUSTOM_HABITS_MAX = 20;
export const COUNTDOWNS_MAX = 10;
export const COUNTDOWN_LABEL_MAX_LENGTH = 40;
/** The furthest ahead a countdown can be set, in days. */
export const COUNTDOWN_MAX_DAYS = 3650;

export const CORE_HABITS: readonly Habit[] = [
  { id: 'core-move', label: 'Move for 30 minutes', core: true },
  { id: 'core-read', label: 'Read 20 pages', core: true },
  { id: 'core-mindful', label: 'Meditate for 10 minutes', core: true },
  { id: 'core-plan', label: 'Plan tomorrow', core: true },
];

export const EMPTY_DAY: DayLog = Object.freeze({
  focus: '',
  journal: '',
  notes: [],
  habitsDone: [],
  habitsSkipped: [],
  water: 0,
  energy: null,
  mood: null,
  sleep: null,
  expenses: [],
  focusMinutes: 0,
}) as DayLog;

export const initialState: HubState = {
  habits: [...CORE_HABITS],
  days: {},
  settings: DEFAULT_SETTINGS,
  countdowns: [],
  focusTimer: null,
};

export type Action =
  | {
      type: 'hydrate';
      habits: Habit[];
      days: Record<string, DayLog>;
      settings: Settings;
      countdowns?: Countdown[];
      focusTimer?: FocusTimer | null;
    }
  | { type: 'skipHabit'; date: string; id: string }
  | { type: 'moveHabit'; id: string; nextTo: string; where: 'before' | 'after' }
  | { type: 'startFocus'; date: string; now: number; minutes: number }
  | { type: 'endFocus'; now: number }
  | { type: 'cancelFocus' }
  | { type: 'addCountdown'; countdown: Countdown }
  | { type: 'removeCountdown'; id: string }
  | { type: 'renameHabit'; id: string; label: string }
  | { type: 'updateSettings'; patch: Partial<Settings> }
  | { type: 'restoreNote'; date: string; note: Note }
  | { type: 'restoreExpense'; date: string; expense: Expense }
  | { type: 'restoreHabit'; date: string; habit: Habit; index: number; wasDone: boolean; wasSkipped?: boolean }
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
  | { type: 'setJournal'; date: string; text: string }
  | { type: 'setHabitDays'; id: string; days: number[] | null }
  | { type: 'setSleep'; date: string; value: number | null }
  | { type: 'toggleTask'; date: string; id: string; now: number }
  | { type: 'carryOver'; to: string; items: { from: string; id: string; copy: { id: string; createdAt: number } }[] }
  | { type: 'editNote'; date: string; id: string; text: string; now: number }
  | { type: 'importBackup'; habits: Habit[]; days: Record<string, DayLog>; countdowns?: Countdown[] }
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
      return {
        habits: action.habits,
        days: action.days,
        settings: action.settings,
        countdowns: action.countdowns ?? [],
        focusTimer: action.focusTimer ?? null,
      };

    case 'skipHabit': {
      if (!state.habits.some((h) => h.id === action.id)) return state;
      return updateDay(state, action.date, (d) =>
        d.habitsSkipped.includes(action.id)
          ? { ...d, habitsSkipped: d.habitsSkipped.filter((id) => id !== action.id) }
          : // Set aside, so not done either.
            { ...d, habitsSkipped: [...d.habitsSkipped, action.id], habitsDone: d.habitsDone.filter((id) => id !== action.id) },
      );
    }

    case 'moveHabit': {
      const habit = state.habits.find((h) => h.id === action.id);
      if (!habit || action.id === action.nextTo) return state;
      const rest = state.habits.filter((h) => h.id !== action.id);
      const at = rest.findIndex((h) => h.id === action.nextTo);
      if (at === -1) return state;
      const habits = [...rest];
      habits.splice(action.where === 'before' ? at : at + 1, 0, habit);
      return habits.every((h, i) => h === state.habits[i]) ? state : { ...state, habits };
    }

    case 'startFocus': {
      if (state.focusTimer || !FOCUS_LENGTHS.includes(action.minutes)) return state;
      return {
        ...state,
        focusTimer: { date: action.date, startedAt: action.now, endsAt: action.now + action.minutes * 60_000 },
      };
    }

    // Finished, or stopped early: the whole minutes done go to the day it was started on.
    case 'endFocus': {
      const t = state.focusTimer;
      if (!t) return state;
      const minutes = focusMinutesDone(t, action.now);
      const next = { ...state, focusTimer: null };
      if (minutes === 0) return next;
      return updateDay(next, t.date, (d) => ({ ...d, focusMinutes: Math.min(FOCUS_MINUTES_MAX, d.focusMinutes + minutes) }));
    }

    case 'cancelFocus':
      return state.focusTimer ? { ...state, focusTimer: null } : state;

    case 'addCountdown': {
      const label = action.countdown.label.trim().slice(0, COUNTDOWN_LABEL_MAX_LENGTH);
      if (!label || state.countdowns.length >= COUNTDOWNS_MAX) return state;
      if (state.countdowns.some((c) => c.id === action.countdown.id)) return state;
      return { ...state, countdowns: sortCountdowns([...state.countdowns, { ...action.countdown, label }]) };
    }

    case 'removeCountdown': {
      const countdowns = state.countdowns.filter((c) => c.id !== action.id);
      return countdowns.length === state.countdowns.length ? state : { ...state, countdowns };
    }

    case 'renameHabit': {
      const label = action.label.trim().slice(0, HABIT_MAX_LENGTH);
      const i = state.habits.findIndex((h) => h.id === action.id);
      if (i === -1 || state.habits[i].core || !label || state.habits[i].label === label) return state;
      const clash = state.habits.some((h, j) => j !== i && h.label.toLowerCase() === label.toLowerCase());
      if (clash) return state;
      const habits = [...state.habits];
      habits[i] = { ...habits[i], label };
      return { ...state, habits };
    }

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
        relockAfterSec:
          p.relockAfterSec !== undefined && RELOCK_CHOICES_SEC.includes(p.relockAfterSec)
            ? p.relockAfterSec
            : cur.relockAfterSec,
        hideAmounts: p.hideAmounts === undefined ? cur.hideAmounts : p.hideAmounts === true,
        focusLength:
          p.focusLength !== undefined && FOCUS_LENGTHS.includes(p.focusLength) ? p.focusLength : cur.focusLength,
        homeOrder: p.homeOrder === undefined ? cur.homeOrder : normalizeHomeOrder(p.homeOrder),
        homeHidden: p.homeHidden === undefined ? cur.homeHidden : normalizeHomeHidden(p.homeHidden),
      };
      const same =
        next.waterGoal === cur.waterGoal &&
        next.reminderHour === cur.reminderHour &&
        next.lockEnabled === cur.lockEnabled &&
        next.haptics === cur.haptics &&
        next.dailyBudgetCents === cur.dailyBudgetCents &&
        next.relockAfterSec === cur.relockAfterSec &&
        next.hideAmounts === cur.hideAmounts &&
        next.focusLength === cur.focusLength &&
        next.homeOrder.join() === cur.homeOrder.join() &&
        next.homeHidden.join() === cur.homeHidden.join();
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
      habits.splice(clamp(action.index, 0, habits.length), 0, action.habit);
      const next = { ...state, habits };
      const id = action.habit.id;
      if (action.wasDone) return updateDay(next, action.date, (d) => ({ ...d, habitsDone: [...d.habitsDone, id] }));
      if (action.wasSkipped) return updateDay(next, action.date, (d) => ({ ...d, habitsSkipped: [...d.habitsSkipped, id] }));
      return next;
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
      return updateDay(state, action.date, (d) =>
        d.habitsDone.includes(action.id)
          ? { ...d, habitsDone: d.habitsDone.filter((id) => id !== action.id) }
          : // Ticking a habit that was set aside takes it back.
            { ...d, habitsDone: [...d.habitsDone, action.id], habitsSkipped: d.habitsSkipped.filter((id) => id !== action.id) },
      );
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
        d.habitsDone.includes(action.id) || d.habitsSkipped.includes(action.id)
          ? {
              ...d,
              habitsDone: d.habitsDone.filter((id) => id !== action.id),
              habitsSkipped: d.habitsSkipped.filter((id) => id !== action.id),
            }
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

    case 'setJournal': {
      const journal = cleanJournal(action.text);
      return updateDay(state, action.date, (d) => (journal === d.journal ? d : { ...d, journal }));
    }

    case 'setHabitDays': {
      const i = state.habits.findIndex((h) => h.id === action.id);
      if (i === -1) return state;
      const days = action.days === null ? undefined : normalizeDays(action.days);
      if (days === null) return state; // a habit needs at least one day
      const cur = state.habits[i];
      if (sameDays(cur.days, days)) return state;
      const habits = [...state.habits];
      const next: Habit = { id: cur.id, label: cur.label, core: cur.core };
      if (days) next.days = days;
      habits[i] = next;
      return { ...state, habits };
    }

    case 'setSleep':
      return updateDay(state, action.date, (d) => {
        const sleep = action.value === null ? null : roundSleep(action.value);
        return sleep === d.sleep ? d : { ...d, sleep };
      });

    case 'toggleTask':
      return updateDay(state, action.date, (d) => {
        const i = d.notes.findIndex((n) => n.id === action.id);
        if (i === -1 || !d.notes[i].task || d.notes[i].carriedTo) return d;
        const notes = [...d.notes];
        const { doneAt, ...rest } = notes[i];
        notes[i] = doneAt === undefined ? { ...rest, doneAt: action.now } : rest;
        return { ...d, notes };
      });

    // Unfinished to-dos from earlier days move to today: each original is
    // marked as brought over (so it is offered only once), and a copy with
    // a new id, the caller's, is added to today.
    case 'carryOver': {
      let next = state;
      const added: Note[] = [];
      for (const { from, id, copy } of action.items) {
        if (from >= action.to) continue;
        const i = getDay(next, from).notes.findIndex((n) => n.id === id);
        const original = i === -1 ? null : getDay(next, from).notes[i];
        if (!original || !isOpenTask(original)) continue;
        next = updateDay(next, from, (d) => {
          const notes = [...d.notes];
          notes[i] = { ...original, carriedTo: action.to };
          return { ...d, notes };
        });
        added.push({ id: copy.id, text: original.text, createdAt: copy.createdAt, task: true, carriedFrom: from });
      }
      if (added.length === 0) return state;
      return updateDay(next, action.to, (d) => ({ ...d, notes: [...added, ...d.notes] }));
    }

    case 'importBackup':
      return mergeBackup(state, action.habits, action.days, action.countdowns).state;

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
  countdownsAdded: number;
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
  countdowns: Countdown[] = [],
): { state: HubState; stats: MergeStats } {
  const stats: MergeStats = {
    daysAdded: 0,
    daysMerged: 0,
    notesAdded: 0,
    expensesAdded: 0,
    habitsAdded: 0,
    countdownsAdded: 0,
  };

  // Countdowns: by id, up to the cap; the phone's own come first.
  let nextCountdowns = state.countdowns;
  for (const c of countdowns) {
    if (nextCountdowns.length >= COUNTDOWNS_MAX || nextCountdowns.some((x) => x.id === c.id)) continue;
    nextCountdowns = [...nextCountdowns, c];
    stats.countdownsAdded++;
  }
  if (nextCountdowns !== state.countdowns) nextCountdowns = sortCountdowns(nextCountdowns);

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
      // Done on either wins over set aside on the other.
      const skipped = [...new Set([...mine.habitsSkipped, ...theirs.habitsSkipped])].filter((id) => !habitsDone.includes(id));
      const candidate: DayLog = {
        focus: mine.focus || theirs.focus,
        journal: mine.journal || theirs.journal,
        notes: notes.list,
        expenses: expenses.list,
        habitsDone: habitsDone.length === mine.habitsDone.length ? mine.habitsDone : habitsDone,
        habitsSkipped: skipped.join() === mine.habitsSkipped.join() ? mine.habitsSkipped : skipped,
        water: Math.max(mine.water, theirs.water),
        energy: mine.energy ?? theirs.energy,
        mood: mine.mood ?? theirs.mood,
        sleep: mine.sleep ?? theirs.sleep,
        focusMinutes: Math.max(mine.focusMinutes, theirs.focusMinutes),
      };
      const changed =
        candidate.focus !== mine.focus ||
        candidate.journal !== mine.journal ||
        candidate.notes !== mine.notes ||
        candidate.expenses !== mine.expenses ||
        candidate.habitsDone !== mine.habitsDone ||
        candidate.habitsSkipped !== mine.habitsSkipped ||
        candidate.focusMinutes !== mine.focusMinutes ||
        candidate.water !== mine.water ||
        candidate.energy !== mine.energy ||
        candidate.mood !== mine.mood ||
        candidate.sleep !== mine.sleep;
      if (!changed) continue;
      merged = candidate;
      stats.daysMerged++;
      stats.notesAdded += notes.added;
      stats.expensesAdded += expenses.added;
    }
    if (nextDays === state.days) nextDays = { ...state.days };
    nextDays[date] = merged;
  }

  const unchanged = nextHabits === state.habits && nextDays === state.days && nextCountdowns === state.countdowns;
  return {
    state: unchanged ? state : { ...state, habits: nextHabits, days: nextDays, countdowns: nextCountdowns },
    stats,
  };
}

/** Line breaks kept, ends trimmed, capped. Clearing the text clears the entry. */
export function cleanJournal(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim().slice(0, JOURNAL_MAX_LENGTH);
}

/**
 * Weekdays as a sorted list of 0–6. All seven means every day (undefined);
 * none is not a schedule (null).
 */
export function normalizeDays(days: readonly unknown[]): number[] | undefined | null {
  const set = [...new Set(days.filter((d): d is number => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6))].sort();
  if (set.length === 0) return null;
  return set.length === 7 ? undefined : set;
}

function sameDays(a: number[] | undefined, b: number[] | undefined): boolean {
  return (a ?? []).join() === (b ?? []).join();
}

/** Whether the habit is meant for that date. */
export function isScheduled(habit: Pick<Habit, 'days'>, date: string): boolean {
  return !habit.days || habit.days.includes(parseDateKey(date).getDay());
}

/**
 * Whether the habit counts on that day: meant for it, and not set aside.
 * A day off and a skipped day both leave a streak as it was.
 */
export function isDue(habit: Pick<Habit, 'id' | 'days'>, date: string, day: Pick<DayLog, 'habitsSkipped'> | null | undefined): boolean {
  return isScheduled(habit, date) && !(day?.habitsSkipped.includes(habit.id) ?? false);
}

/** Whole minutes of a focus session done by `now`, never more than its length. */
export function focusMinutesDone(t: FocusTimer, now: number): number {
  const length = Math.round((t.endsAt - t.startedAt) / 60_000);
  return Math.max(0, Math.min(length, Math.floor((now - t.startedAt) / 60_000)));
}

/** "1 h 15 min", "45 min" */
export function focusLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Every card exactly once: unknown ones dropped, missing ones added at their default place. */
export function normalizeHomeOrder(list: readonly unknown[]): HomeCard[] {
  const known = [...new Set(list.filter(isHomeCard))];
  for (const card of HOME_CARDS) {
    if (known.includes(card)) continue;
    // A card this build added: it goes after the card it follows by default.
    const i = HOME_CARDS.indexOf(card);
    const after = i === 0 ? -1 : known.indexOf(HOME_CARDS[i - 1]);
    known.splice(after + 1, 0, card);
  }
  return known;
}

/** Known cards, once each, in default order. */
export function normalizeHomeHidden(list: readonly unknown[]): HomeCard[] {
  return HOME_CARDS.filter((c) => list.includes(c));
}

/** Half-hour steps between 0 and SLEEP_MAX. */
export function roundSleep(hours: number): number {
  return clamp(Math.round(hours / SLEEP_STEP) * SLEEP_STEP, 0, SLEEP_MAX);
}

/** A to-do that still needs doing: not ticked off, not brought over to another day. */
export function isOpenTask(n: Note): boolean {
  return n.task === true && n.doneAt === undefined && !n.carriedTo;
}

/**
 * Unfinished to-dos from the days before `today`, newest day first, looking
 * back `lookback` days.
 */
export function openTasksBefore(
  state: HubState,
  today: string,
  lookback = CARRY_LOOKBACK_DAYS,
): { from: string; note: Note }[] {
  const days = lastNDays(today, lookback + 1).slice(0, -1).reverse();
  return days.flatMap((from) => (state.days[from]?.notes ?? []).filter(isOpenTask).map((note) => ({ from, note })));
}

/** One line, trimmed, capped. Clearing the text clears the focus. */
export function cleanFocus(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, FOCUS_MAX_LENGTH);
}

/** Soonest first; same day, by name. */
export function sortCountdowns(list: Countdown[]): Countdown[] {
  return [...list].sort((a, b) => (a.date === b.date ? a.label.localeCompare(b.label) : a.date < b.date ? -1 : 1));
}

/** Whole days from `today` to `date` (negative once it has passed). Local calendar days, not 24-hour spans. */
export function daysUntil(date: string, today: string): number {
  const a = parseDateKey(today);
  const b = parseDateKey(date);
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86_400_000);
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
  const habit = state.habits.find((h) => h.id === habitId) ?? { id: habitId, days: undefined };
  const days = lastNDays(today, maxDays + 1).reverse(); // today first
  const doneOn = (date: string) => state.days[date]?.habitsDone.includes(habitId) ?? false;
  const due = (date: string) => isDue(habit, date, state.days[date]);
  // Days off and skipped days are stepped over: they neither count nor break it.
  let i = doneOn(days[0]) && due(days[0]) ? 0 : 1;
  let streak = 0;
  for (; i < days.length && streak < maxDays; i++) {
    if (!due(days[i])) continue;
    if (!doneOn(days[i])) break;
    streak++;
  }
  return streak;
}

/**
 * Distinct expenses from today and the RECENT_EXPENSE_DAYS days before,
 * most recent first, for adding again with one tap. Two are the same when
 * label, amount and category all match.
 */
export function recentExpenses(state: HubState, today: string): Expense[] {
  const seen = new Set<string>();
  const out: Expense[] = [];
  const days = lastNDays(today, RECENT_EXPENSE_DAYS + 1).reverse(); // today first
  for (const date of days) {
    for (const e of state.days[date]?.expenses ?? []) {
      const key = `${e.label.trim().toLowerCase()}|${e.cents}|${e.category}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(e);
      if (out.length === RECENT_EXPENSES_MAX) return out;
    }
  }
  return out;
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
    day.journal !== '' ||
    day.notes.length > 0 ||
    day.habitsDone.length > 0 ||
    day.habitsSkipped.length > 0 ||
    day.focusMinutes > 0 ||
    day.water > 0 ||
    day.energy !== null ||
    day.mood !== null ||
    day.sleep !== null ||
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
