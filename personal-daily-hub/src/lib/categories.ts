// Expense categories and the daily budget. Pure.

export const EXPENSE_CATEGORIES = ['food', 'transport', 'shopping', 'bills', 'fun', 'other'] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/** Expenses saved before categories existed, or with one this build doesn't know, are "other". */
export const DEFAULT_CATEGORY: ExpenseCategory = 'other';

export const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  food: 'Food',
  transport: 'Transport',
  shopping: 'Shopping',
  bills: 'Bills',
  fun: 'Fun',
  other: 'Other',
};

export function isCategory(v: unknown): v is ExpenseCategory {
  return typeof v === 'string' && (EXPENSE_CATEGORIES as readonly string[]).includes(v);
}

type Spend = { cents: number; category: ExpenseCategory };

/** Total per category, largest first; categories with nothing spent are left out. */
export function categoryTotals(expenses: readonly Spend[]): { category: ExpenseCategory; cents: number }[] {
  const sums = new Map<ExpenseCategory, number>();
  for (const e of expenses) sums.set(e.category, (sums.get(e.category) ?? 0) + e.cents);
  return [...sums.entries()]
    .map(([category, cents]) => ({ category, cents }))
    .sort(
      (a, b) => b.cents - a.cents || EXPENSE_CATEGORIES.indexOf(a.category) - EXPENSE_CATEGORIES.indexOf(b.category),
    );
}

// ---- daily budget ---------------------------------------------------------

/** The amounts the budget stepper moves through, in cents. */
export const BUDGET_STEPS_CENTS: readonly number[] = [
  1000, 1500, 2000, 2500, 3000, 4000, 5000, 7500, 10000, 15000, 20000, 30000, 50000,
];

/**
 * One step up or down from `current` (null = no budget). Down from the
 * smallest step turns the budget off; up from off starts at the smallest.
 * A value between steps (from an older build or a backup) moves to the
 * nearest step in that direction.
 */
export function stepBudget(
  current: number | null,
  dir: 1 | -1,
  steps: readonly number[] = BUDGET_STEPS_CENTS,
): number | null {
  if (current === null) return dir === 1 ? steps[0] : null;
  if (dir === 1) return steps.find((s) => s > current) ?? steps[steps.length - 1];
  const lower = [...steps].reverse().find((s) => s < current);
  return lower ?? null;
}

export function isBudget(v: unknown, steps: readonly number[] = BUDGET_STEPS_CENTS): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= steps[0] && v <= steps[steps.length - 1];
}

/** Monthly budget choices, $100 to $10,000. */
export const MONTHLY_BUDGET_STEPS_CENTS: readonly number[] = [
  10000, 20000, 30000, 40000, 50000, 75000, 100000, 125000, 150000, 200000, 250000, 300000, 400000, 500000, 750000,
  1000000,
];
