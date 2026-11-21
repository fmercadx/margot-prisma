// The week at a glance, for the history card. Pure.

import { categoryTotals, type ExpenseCategory } from './categories';
import { isDue, type DayLog, type Habit } from './store';

/** Habits as the summaries need them: an id, and the weekdays it is meant for. */
export type HabitPlan = Pick<Habit, 'id' | 'days'>;
const plans = (habits: readonly (HabitPlan | string)[]): HabitPlan[] =>
  habits.map((h) => (typeof h === 'string' ? { id: h } : h));

/**
 * Habits done out of habits due, over the given days. A habit counts only
 * on the days it is meant for and wasn't set aside; a day without a date
 * counts every habit.
 */
function habitShare(days: { date?: string; log: DayLog | null }[], habits: HabitPlan[]): number | null {
  let due = 0;
  let done = 0;
  for (const { date, log } of days) {
    for (const h of habits) {
      if (date !== undefined && !isDue(h, date, log)) continue;
      due++;
      if (log?.habitsDone.includes(h.id)) done++;
    }
  }
  return due ? done / due : null;
}

export type WeekSummary = {
  avgWater: number | null; // glasses, over days with any water logged
  avgEnergy: number | null; // 1–10, over days energy was logged
  avgMood: number | null; // 1–5, over days mood was logged
  avgSleep: number | null; // hours, over nights sleep was logged
  spentCents: number;
  habitRate: number | null; // 0–1: habits done / habits due, day by day
  topCategory: { category: ExpenseCategory; cents: number } | null; // where most money went
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function weekSummary(
  days: { date?: string; log: DayLog | null }[],
  habits: readonly (HabitPlan | string)[],
): WeekSummary {
  const logs = days.map((d) => d.log);
  const present = logs.filter((l): l is DayLog => l !== null);
  return {
    avgWater: mean(present.filter((l) => l.water > 0).map((l) => l.water)),
    avgEnergy: mean(present.flatMap((l) => (l.energy === null ? [] : [l.energy]))),
    avgMood: mean(present.flatMap((l) => (l.mood === null ? [] : [l.mood]))),
    avgSleep: mean(present.flatMap((l) => (l.sleep === null ? [] : [l.sleep]))),
    spentCents: present.reduce((n, l) => n + l.expenses.reduce((m, e) => m + e.cents, 0), 0),
    // Every day in the window counts, logged or not: a skipped day is a miss.
    habitRate: habitShare(days, plans(habits)),
    topCategory: categoryTotals(present.flatMap((l) => l.expenses))[0] ?? null,
  };
}

export type MonthSummary = {
  /** Days of the month the figures cover: up to today, and only days in memory. */
  covered: number;
  habitRate: number | null; // 0–1 over the covered days
  spentCents: number;
  avgSleep: number | null;
  avgMood: number | null; // 1–5, over days mood was logged
  categories: { category: ExpenseCategory; cents: number }[];
};

/**
 * One calendar month for the history card. `dates` are the month's day keys
 * that count: already begun, and loaded.
 */
export function monthSummary(
  days: Record<string, DayLog>,
  dates: string[],
  habits: readonly (HabitPlan | string)[],
): MonthSummary {
  const logs = dates.map((d) => days[d]).filter((l): l is DayLog => l !== undefined);
  return {
    covered: dates.length,
    habitRate: habitShare(dates.map((date) => ({ date, log: days[date] ?? null })), plans(habits)),
    spentCents: logs.reduce((n, l) => n + l.expenses.reduce((m, e) => m + e.cents, 0), 0),
    avgSleep: mean(logs.flatMap((l) => (l.sleep === null ? [] : [l.sleep]))),
    avgMood: mean(logs.flatMap((l) => (l.mood === null ? [] : [l.mood]))),
    categories: categoryTotals(logs.flatMap((l) => l.expenses)),
  };
}
