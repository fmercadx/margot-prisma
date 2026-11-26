// Spending so far this calendar month, against a monthly budget. Pure.

import { dateKey, parseDateKey } from './date';
import type { DayLog } from './store';

export type MonthToDate = {
  spentCents: number; // the month's expenses, from the 1st to `today`
  daysLeft: number; // days still to come this month, today included
  /** What can still be spent each remaining day; 0 once the budget is used up. */
  perDayCents: number;
  overCents: number; // how far over the budget, or 0
};

/**
 * The month `today` falls in, from the 1st up to and including today.
 * `days` must hold every day of the month so far (the 60 days in memory do).
 */
export function monthToDate(days: Record<string, DayLog>, today: string, budgetCents: number): MonthToDate {
  const d = parseDateKey(today);
  const year = d.getFullYear();
  const month = d.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let spentCents = 0;
  for (let day = 1; day <= d.getDate(); day++) {
    const log = days[dateKey(new Date(year, month, day))];
    if (log) for (const e of log.expenses) spentCents += e.cents;
  }
  const daysLeft = daysInMonth - d.getDate() + 1;
  const left = budgetCents - spentCents;
  return {
    spentCents,
    daysLeft,
    perDayCents: left > 0 ? Math.floor(left / daysLeft) : 0,
    overCents: left < 0 ? -left : 0,
  };
}
