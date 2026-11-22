// Spending so far this calendar month, against a monthly budget. Pure.

import { EXPENSE_CATEGORIES, type CategoryBudgets, type ExpenseCategory } from './categories';
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

// ---- budgets by category ---------------------------------------------------

export type CategoryBudgetUse = { category: ExpenseCategory; spentCents: number; budgetCents: number };

/** Spent in one category over a calendar month ('YYYY-MM'), from the days given. */
export function categorySpent(days: Record<string, DayLog>, month: string, category: ExpenseCategory): number {
  let cents = 0;
  for (const [date, log] of Object.entries(days)) {
    if (!date.startsWith(`${month}-`)) continue;
    for (const e of log.expenses) if (e.category === category) cents += e.cents;
  }
  return cents;
}

/** Every category with a budget, against what it has had in `month`, in category order. */
export function categoryBudgetUse(
  days: Record<string, DayLog>,
  month: string,
  budgets: CategoryBudgets,
): CategoryBudgetUse[] {
  return EXPENSE_CATEGORIES.flatMap((category) => {
    const budgetCents = budgets[category];
    return budgetCents === undefined
      ? []
      : [{ category, spentCents: categorySpent(days, month, category), budgetCents }];
  });
}

/** The share of a budget at which a category is close to it. */
export const BUDGET_NEAR_SHARE = 0.8;

/**
 * Whether going from `before` to `after` takes spending past 80% of the
 * budget ('near') or past all of it ('over'); null if it crosses neither.
 */
export function budgetCrossing(before: number, after: number, budgetCents: number): 'near' | 'over' | null {
  if (after > budgetCents && before <= budgetCents) return 'over';
  const near = budgetCents * BUDGET_NEAR_SHARE;
  if (after >= near && before < near && after <= budgetCents) return 'near';
  return null;
}
