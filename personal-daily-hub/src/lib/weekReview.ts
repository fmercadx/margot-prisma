// A finished week at a glance, for the review at the top of "This week". Pure.

import { addDays } from './date';
import { goalsOf, hasAnyData, isDue, type HubState } from './store';
import { weekSummary } from './summary';

export type WeekReview = {
  /** The Sunday it started on. */
  week: string;
  /** Days with anything logged. */
  daysLogged: number;
  goals: { done: number; total: number };
  /** Habits done out of habits due, day by day; null if none were due. */
  habitRate: number | null;
  /** The habit done on the largest share of its days (at least three due). */
  steadiest: { label: string; done: number; due: number } | null;
  avgMood: number | null;
  avgSleep: number | null;
  focusMinutes: number;
  spentCents: number;
};

/** How many of a habit's days in the week it must have had to count as steadiest. */
const STEADIEST_MIN_DAYS = 3;

/**
 * The week starting on `week`, from what is in memory, or null if nothing
 * was logged and no goals were set: there is nothing to look back on.
 */
export function weekReview(state: HubState, week: string): WeekReview | null {
  const dates = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const days = dates.map((date) => ({ date, log: state.days[date] ?? null }));
  const logged = days.filter((d) => d.log && hasAnyData(d.log));
  const goals = goalsOf(state.goals, week);
  if (logged.length === 0 && goals.length === 0) return null;

  const summary = weekSummary(days, state.habits);
  let steadiest: WeekReview['steadiest'] = null;
  for (const h of state.habits) {
    let due = 0;
    let done = 0;
    for (const { date, log } of days) {
      if (!isDue(h, date, log)) continue;
      due++;
      if (log?.habitsDone.includes(h.id)) done++;
    }
    if (due < STEADIEST_MIN_DAYS || done === 0) continue;
    const better =
      !steadiest ||
      done / due > steadiest.done / steadiest.due ||
      (done / due === steadiest.done / steadiest.due && done > steadiest.done);
    if (better) steadiest = { label: h.label, done, due };
  }

  return {
    week,
    daysLogged: logged.length,
    goals: { done: goals.filter((g) => g.doneAt !== undefined).length, total: goals.length },
    habitRate: summary.habitRate,
    steadiest,
    avgMood: summary.avgMood,
    avgSleep: summary.avgSleep,
    focusMinutes: days.reduce((n, d) => n + (d.log?.focusMinutes ?? 0), 0),
    spentCents: summary.spentCents,
  };
}
