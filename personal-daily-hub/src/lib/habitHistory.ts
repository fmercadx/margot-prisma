// One habit's last four weeks, for its panel on the home screen. Pure.

import { addDays, lastNDays, weekStart } from './date';
import { hasAnyData, isDue, isScheduled, type HubState } from './store';

export type HabitDay =
  | 'done'
  | 'missed'
  | 'skipped' // set aside that day
  | 'off' // not one of its days
  | 'today' // still to do today: not a miss yet
  | 'future'
  | 'before'; // before the habit's record starts

export type HabitHistory = {
  /** Four weeks, Sunday to Saturday, ending with this week. */
  cells: { date: string; status: HabitDay }[];
  /** Days it was meant for and not set aside, from its record's start up to today. */
  planned: number;
  done: number;
  /** The longest run of planned days done, over the history in memory. */
  best: number;
};

export const HISTORY_WEEKS = 4;

/**
 * Where a habit's record starts, so days before it existed are not counted
 * as misses: the day it was added (custom habits since 1.11, or the first
 * day it was ticked if that is earlier), else the first day it was ticked
 * or set aside (older custom habits), else the first day anything was
 * logged at all (the core four, there from the start).
 */
export function habitRecordStart(state: HubState, habitId: string, loaded: string[]): string | null {
  const habit = state.habits.find((h) => h.id === habitId);
  if (!habit) return null;
  const logged = loaded.filter((d) => state.days[d] && hasAnyData(state.days[d]));
  const touched = logged.find(
    (d) => state.days[d].habitsDone.includes(habitId) || state.days[d].habitsSkipped.includes(habitId),
  );
  // A tick from before the day it was added (restored from a backup, say) still counts.
  if (habit.since) return touched && touched < habit.since ? touched : habit.since;
  if (!habit.core && touched) return touched;
  return logged[0] ?? null;
}

/**
 * The habit's last four weeks as a grid, how many planned days it was done
 * on, and its best streak. `loadedDays` is how much history is in memory.
 */
export function habitHistory(state: HubState, habitId: string, today: string, loadedDays: number): HabitHistory {
  const habit = state.habits.find((h) => h.id === habitId);
  const loaded = lastNDays(today, loadedDays);
  const from = habitRecordStart(state, habitId, loaded) ?? today;
  const first = addDays(weekStart(today), -7 * (HISTORY_WEEKS - 1));
  const cells: HabitHistory['cells'] = [];
  let planned = 0;
  let done = 0;
  for (let i = 0; i < 7 * HISTORY_WEEKS; i++) {
    const date = addDays(first, i);
    const log = state.days[date];
    const ticked = log?.habitsDone.includes(habitId) ?? false;
    const due = !!habit && isDue(habit, date, log);
    let status: HabitDay;
    if (date > today) status = 'future';
    else if (date < from || !habit) status = 'before';
    else if (ticked) status = 'done';
    else if (!isScheduled(habit, date)) status = 'off';
    else if (!due) status = 'skipped';
    else if (date === today) status = 'today';
    else status = 'missed';
    if (due && date >= from && date <= today && (date < today || ticked)) {
      planned++;
      if (ticked) done++;
    }
    cells.push({ date, status });
  }

  // The best run, by the streak's own rules: days off and skipped days are
  // stepped over, and today not yet ticked doesn't end it.
  let best = 0;
  let run = 0;
  if (habit) {
    for (const date of loaded) {
      if (date < from || !isDue(habit, date, state.days[date])) continue;
      if (state.days[date]?.habitsDone.includes(habitId)) best = Math.max(best, ++run);
      else if (date !== today) run = 0;
    }
  }
  return { cells, planned, done, best };
}
