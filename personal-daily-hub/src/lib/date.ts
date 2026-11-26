// Date helpers. All of them work in the device's *local* time zone.
//
// `toISOString()` is deliberately avoided: it is UTC, so in the Americas it
// rolls the day over in the evening and files tonight's entries under
// tomorrow's key.

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DD` for the given moment, in local time. */
export function dateKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parses a `YYYY-MM-DD` key back to local midnight of that day. */
export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return dateKey(parseDateKey(value)) === value; // rejects 2026-02-31
}

/**
 * The `n` day keys ending at `endKey`, oldest first. Steps by calendar day,
 * not by 24h, so a daylight-saving change cannot skip or repeat a day.
 */
export function lastNDays(endKey: string, n: number): string[] {
  const end = parseDateKey(endKey);
  const keys: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    keys.push(dateKey(new Date(end.getFullYear(), end.getMonth(), end.getDate() - i)));
  }
  return keys;
}

/** `n` calendar days after `key` (before, if negative). */
export function addDays(key: string, n: number): string {
  const d = parseDateKey(key);
  return dateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
}

/** The Sunday a week starts on, for any day in it (weeks run Sunday to Saturday, as on the calendar). */
export function weekStart(key: string): string {
  return addDays(key, -parseDateKey(key).getDay());
}

/** "Nov 15 – 21", "Nov 29 – Dec 5": the week starting on `start`. */
export function weekRangeLabel(start: string): string {
  const a = parseDateKey(start);
  const b = parseDateKey(addDays(start, 6));
  const mon = (d: Date) => MONTHS[d.getMonth()].slice(0, 3);
  return a.getMonth() === b.getMonth()
    ? `${mon(a)} ${a.getDate()} – ${b.getDate()}`
    : `${mon(a)} ${a.getDate()} – ${mon(b)} ${b.getDate()}`;
}

export function weekdayName(d: Date): string {
  return DAYS[d.getDay()];
}

/** [1, 3, 5] -> "Mon, Wed, Fri"; also "Weekdays" and "Weekends". */
export function weekdaysLabel(days: readonly number[]): string {
  const key = [...days].sort().join();
  if (key === '1,2,3,4,5') return 'Weekdays';
  if (key === '0,6') return 'Weekends';
  return [...days].sort().map((d) => DAYS[d].slice(0, 3)).join(', ');
}

export function weekdayInitial(key: string): string {
  return DAYS[parseDateKey(key).getDay()].charAt(0);
}

/** "November 8, 2026" */
export function longDate(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** "November 2026" */
export function monthTitle(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** "8:05 PM" */
export function clockTime(d: Date | number): string {
  const date = typeof d === 'number' ? new Date(d) : d;
  const h24 = date.getHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${pad(date.getMinutes())} ${h24 < 12 ? 'AM' : 'PM'}`;
}

export function greeting(d: Date): string {
  const h = d.getHours();
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export function msUntilNextMinute(d: Date = new Date()): number {
  return 60_000 - (d.getSeconds() * 1000 + d.getMilliseconds());
}

export function msUntilMidnight(d: Date = new Date()): number {
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  return next.getTime() - d.getTime();
}
