// Money is held as integer cents. Summing floats drifts (0.1 + 0.2 !==
// 0.3), and a running total is exactly where that drift would show.

/** The largest single expense accepted: $1,000,000. */
export const MAX_EXPENSE_CENTS = 100_000_000;

/**
 * Parses what someone typed into the amount field. Accepts "12", "12.5",
 * "$12.50", "1,234.56", and a decimal comma ("12,50"). Returns null for
 * anything else — including zero, negatives, and more than two decimals.
 */
export function parseAmountToCents(input: string): number | null {
  let s = input.trim().replace(/^\$/, '').replace(/\s/g, '');
  if (!s) return null;

  if (s.includes(',') && s.includes('.')) {
    s = s.replace(/,/g, ''); // "1,234.56": the commas are grouping
  } else if (/^\d+,\d{1,2}$/.test(s)) {
    s = s.replace(',', '.'); // "12,50": a decimal comma
  } else if (/^\d{1,3}(,\d{3})+$/.test(s)) {
    s = s.replace(/,/g, ''); // "1,234": grouping only
  }

  const m = /^(\d*)(?:\.(\d{0,2}))?$/.exec(s);
  if (!m || (m[1] === '' && !m[2])) return null;

  const whole = m[1] === '' ? 0 : Number(m[1]);
  const frac = Number((m[2] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(whole)) return null;

  const cents = whole * 100 + frac;
  if (cents <= 0 || cents > MAX_EXPENSE_CENTS) return null;
  return cents;
}

/** 123456 -> "$1,234.56" */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}$${whole}.${String(abs % 100).padStart(2, '0')}`;
}

/** 123456 -> "$1.2K", for chart labels where space is tight. */
export function formatCentsCompact(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (dollars >= 10_000) return `$${Math.round(dollars / 1000)}K`;
  if (dollars >= 1_000) return `$${(dollars / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return `$${Math.round(dollars)}`;
}
