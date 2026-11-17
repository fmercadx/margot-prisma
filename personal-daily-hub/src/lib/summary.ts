// The week at a glance, for the history card. Pure.

import type { DayLog } from './store';

export type WeekSummary = {
  avgWater: number | null; // glasses, over days with any water logged
  avgEnergy: number | null; // 1–10, over days energy was logged
  avgMood: number | null; // 1–5, over days mood was logged
  spentCents: number;
  habitRate: number | null; // 0–1: ticks / (days × habits)
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
    spentCents: present.reduce((n, l) => n + l.expenses.reduce((m, e) => m + e.cents, 0), 0),
    // Every day in the window counts, logged or not: a skipped day is a miss.
    habitRate: ids.size && days.length ? ticks / (days.length * ids.size) : null,
  };
}
