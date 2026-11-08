// State shape and every way it can change. Pure: no React, no storage, no
// clock — the date and timestamps arrive in the actions — so it is tested
// directly.
//
// Daily data is keyed by local date string, so "today" starts empty each
// morning while every earlier day stays where it was:
//
//   {
//     habits: [ { id, label, core } ],            // definitions, carried across days
//     days: {
//       '2026-11-07': { notes, habitsDone, water, energy, expenses },
//       '2026-11-08': { ... },                     // today
//     },
//   }

export type Note = { id: string; text: string; createdAt: number };
export type Expense = { id: string; cents: number; label: string; createdAt: number };
export type Habit = { id: string; label: string; core: boolean };

export type DayLog = {
  notes: Note[]; // newest first
  habitsDone: string[]; // ids of habits ticked that day
  water: number; // glasses
  energy: number | null; // 1–10, null until logged
  expenses: Expense[]; // newest first
};

export type HubState = {
  habits: Habit[];
  days: Record<string, DayLog>;
};

export const WATER_GOAL = 8;
export const WATER_MAX = 20;
export const ENERGY_MIN = 1;
export const ENERGY_MAX = 10;
export const NOTE_MAX_LENGTH = 500;
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
  notes: [],
  habitsDone: [],
  water: 0,
  energy: null,
  expenses: [],
}) as DayLog;

export const initialState: HubState = { habits: [...CORE_HABITS], days: {} };

export type Action =
  | { type: 'hydrate'; habits: Habit[]; days: Record<string, DayLog> }
  | { type: 'mergeDays'; days: Record<string, DayLog> }
  | { type: 'addNote'; date: string; note: Note }
  | { type: 'deleteNote'; date: string; id: string }
  | { type: 'toggleHabit'; date: string; id: string }
  | { type: 'addHabit'; habit: Habit }
  | { type: 'removeHabit'; date: string; id: string }
  | { type: 'adjustWater'; date: string; delta: number }
  | { type: 'setEnergy'; date: string; value: number }
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
      return { habits: action.habits, days: action.days };

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

    case 'addExpense': {
      const { cents } = action.expense;
      if (!Number.isInteger(cents) || cents <= 0) return state;
      const label = action.expense.label.trim().slice(0, EXPENSE_LABEL_MAX_LENGTH);
      return updateDay(state, action.date, (d) => ({
        ...d,
        expenses: [{ ...action.expense, label }, ...d.expenses],
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

// ---- selectors ------------------------------------------------------------

export function totalCents(day: DayLog): number {
  return day.expenses.reduce((sum, e) => sum + e.cents, 0);
}

/** Ticked habits that still exist — a removed habit's old tick doesn't count. */
export function habitsDoneCount(state: HubState, day: DayLog): number {
  return state.habits.filter((h) => day.habitsDone.includes(h.id)).length;
}

export function hasAnyData(day: DayLog): boolean {
  return (
    day.notes.length > 0 ||
    day.habitsDone.length > 0 ||
    day.water > 0 ||
    day.energy !== null ||
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
