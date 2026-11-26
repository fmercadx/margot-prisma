// "On this day": what was written a week, a month and a year ago. Pure.

import { dateKey, parseDateKey } from './date';
import type { DayLog } from './store';

export type Memory = {
  label: string; // "A week ago"
  date: string;
  focus: string;
  good: string[];
  journal: string; // the first line
  note: string; // the oldest note of the day, when nothing else was written
};

/**
 * The days looked back to. A month ago in a shorter month is its last day
 * (March 31 looks back to February 28); a year ago from February 29 is
 * February 28.
 */
export function memoryDates(today: string): { label: string; date: string }[] {
  const d = parseDateKey(today);
  const y = d.getFullYear();
  const m = d.getMonth();
  const day = d.getDate();
  const clamp = (year: number, month: number) =>
    new Date(year, month, Math.min(day, new Date(year, month + 1, 0).getDate()));
  return [
    { label: 'A week ago', date: dateKey(new Date(y, m, day - 7)) },
    { label: 'A month ago', date: dateKey(clamp(y, m - 1)) },
    { label: 'A year ago', date: dateKey(clamp(y - 1, m)) },
  ];
}

/** What is worth showing from a day, or null if nothing was written then. */
export function memoryOf(label: string, date: string, log: DayLog | null | undefined): Memory | null {
  if (!log) return null;
  const journal = log.journal.split('\n').find((l) => l.trim()) ?? '';
  const written = log.focus || log.gratitude.length > 0 || journal;
  const note = written ? '' : ([...log.notes].reverse().find((n) => !n.task)?.text ?? '');
  if (!written && !note) return null;
  return { label, date, focus: log.focus, good: log.gratitude, journal, note };
}
