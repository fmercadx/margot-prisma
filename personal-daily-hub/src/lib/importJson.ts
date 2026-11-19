// Reading a backup file back in. Pure, so it is tested without a picker.
//
// A backup is outside input: anyone can hand the app a file named like
// one. So this checks size and shape before anything else, keeps only what
// passes the same sanitizers stored data goes through (with their length
// and count caps), and never fills a gap with a guess. Merging into what is
// on the phone happens separately (mergeBackup in store.ts), which never
// overwrites or removes anything.

import { dateKey, isDateKey } from './date';
import { sanitizeCountdowns, sanitizeDay, sanitizeHabits } from './storage';
import { hasAnyData, type Countdown, type DayLog, type Habit } from './store';

/** A year of heavy use exports to well under 1 MB. */
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
/** Ten years of days. */
export const IMPORT_MAX_DAYS = 3660;

export type ParsedBackup = {
  habits: Habit[]; // custom habits only
  days: Record<string, DayLog>;
  countdowns: Countdown[];
  exportedAt: string | null;
};

export type ParseResult = { ok: true; backup: ParsedBackup } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const fail = (error: string): ParseResult => ({ ok: false, error });

export function parseBackup(text: string, now: Date = new Date()): ParseResult {
  if (text.length > IMPORT_MAX_BYTES) return fail('That file is too large to be a Daily Hub backup.');

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail('That file is not a Daily Hub backup.');
  }
  if (!isObj(raw) || raw.app !== 'Personal Daily Hub' || !isObj(raw.days)) {
    return fail('That file is not a Daily Hub backup.');
  }
  if (raw.format !== 1) return fail('That backup was made by a newer version of the app. Update the app, then try again.');

  // Real calendar dates only, none in the future (allowing a day for time zones).
  const tomorrow = dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const dates = Object.keys(raw.days)
    .filter((d) => isDateKey(d) && d <= tomorrow)
    .sort();
  if (dates.length > IMPORT_MAX_DAYS) return fail('That backup has more days than the app can restore.');

  const source = raw.days;
  const days: Record<string, DayLog> = {};
  for (const d of dates) {
    const day = sanitizeDay(source[d]);
    if (hasAnyData(day)) days[d] = day;
  }

  return {
    ok: true,
    backup: {
      habits: sanitizeHabits(raw.habits).filter((h) => !h.core),
      days,
      countdowns: sanitizeCountdowns(raw.countdowns),
      exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt.slice(0, 40) : null,
    },
  };
}
