// The week at a glance, for the history card. Pure.

import { categoryTotals, type ExpenseCategory } from './categories';
import type { DayLog } from './store';

export type WeekSummary = {
  avgWater: number | null; // glasses, over days with any water logged
  avgEnergy: number | null; // 1–10, over days energy was logged
  avgMood: number | null; // 1–5, over days mood was logged
  avgSleep: number | null; // hours, over nights sleep was logged
  spentCents: number;
  habitRate: number | null; // 0–1: ticks / (days × habits)
  topCategory: { category: ExpenseCategory; cents: number } | null; // where most money went
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function weekSummary(days: { log: DayLog | null }[], habitIds: string[]): WeekSummary {
  const logs = days.map((d) => d.log);
  const present = logs.filter((l): l is DayLog => l !== null);
  const ids = new Set(habitIds);
  const ticks = present.reduce((n, l) => n + l.habitsDone.filter((id) => ids.has(id)).length, 0);
  return {
    avgWater: mean(present.filter((l) => l.water > 0).map((l) => l.water)),
    avgEnergy: mean(present.flatMap((l) => (l.energy === null ? [] : [l.energy]))),
    avgMood: mean(present.flatMap((l) => (l.mood === null ? [] : [l.mood]))),
    avgSleep: mean(present.flatMap((l) => (l.sleep === null ? [] : [l.sleep]))),
    spentCents: present.reduce((n, l) => n + l.expenses.reduce((m, e) => m + e.cents, 0), 0),
    // Every day in the window counts, logged or not: a skipped day is a miss.
    habitRate: ids.size && days.length ? ticks / (days.length * ids.size) : null,
    topCategory: categoryTotals(present.flatMap((l) => l.expenses))[0] ?? null,
  };
}

export type MonthSummary = {
  /** Days of the month the figures cover: up to today, and only days in memory. */
  covered: number;
  habitRate: number | null; // 0–1 over the covered days
  spentCents: number;
  avgSleep: number | null;
  categories: { category: ExpenseCategory; cents: number }[];
};

/**
 * One calendar month for the history card. `dates` are the month's day keys
 * that count: already begun, and loaded.
 */
export function monthSummary(days: Record<string, DayLog>, dates: string[], habitIds: string[]): MonthSummary {
  const logs = dates.map((d) => days[d]).filter((l): l is DayLog => l !== undefined);
  const ids = new Set(habitIds);
  const ticks = logs.reduce((n, l) => n + l.habitsDone.filter((id) => ids.has(id)).length, 0);
  return {
    covered: dates.length,
    habitRate: ids.size && dates.length ? ticks / (dates.length * ids.size) : null,
    spentCents: logs.reduce((n, l) => n + l.expenses.reduce((m, e) => m + e.cents, 0), 0),
    avgSleep: mean(logs.flatMap((l) => (l.sleep === null ? [] : [l.sleep]))),
    categories: categoryTotals(logs.flatMap((l) => l.expenses)),
  };
}
