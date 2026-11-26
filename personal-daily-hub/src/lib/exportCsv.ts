// Expenses as a spreadsheet (CSV). Pure, so it is tested without a file system.

import { CATEGORY_LABELS } from './categories';
import { dateKey } from './date';
import { EXPORT_FILE_PREFIX } from './exportJson';
import type { DayLog } from './store';

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * One spreadsheet cell. A label is the person's own text, but a cell that
 * starts with = + - @ (or a tab or carriage return) is run as a formula by
 * Excel, Sheets and Numbers, so such a cell is prefixed with an apostrophe:
 * it then shows as typed. Commas, quotes and line breaks are quoted per
 * RFC 4180.
 */
export function csvCell(text: string): string {
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** 123456 -> "1234.56": exact, from integer cents. */
const amount = (cents: number) => `${Math.floor(cents / 100)}.${pad(cents % 100)}`;

/**
 * Every expense, oldest first: date, time (24-hour, local), amount,
 * category and label. Starts with a byte-order mark so Excel reads it as
 * UTF-8, and uses CRLF line ends.
 */
export function buildExpensesCsv(
  days: Record<string, DayLog>,
  now: Date = new Date(),
): { filename: string; csv: string; rows: number } {
  const lines = ['Date,Time,Amount,Category,Label'];
  for (const date of Object.keys(days).sort()) {
    const sorted = [...days[date].expenses].sort((a, b) => a.createdAt - b.createdAt);
    for (const e of sorted) {
      const t = new Date(e.createdAt);
      lines.push(
        [date, `${pad(t.getHours())}:${pad(t.getMinutes())}`, amount(e.cents), CATEGORY_LABELS[e.category], csvCell(e.label)].join(','),
      );
    }
  }
  return {
    filename: `${EXPORT_FILE_PREFIX}expenses-${dateKey(now)}.csv`,
    csv: '﻿' + lines.join('\r\n') + '\r\n',
    rows: lines.length - 1,
  };
}
