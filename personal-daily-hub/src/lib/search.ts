// Searching everything the person has written: notes, each day's focus,
// journal entries, good things and expense labels. Pure; the caller supplies the days (decrypted by the
// storage layer) and nothing leaves the phone.

import { dateKey } from './date';
import type { DayLog, Pinned } from './store';

export type SearchHit = {
  date: string;
  kind: 'focus' | 'note' | 'journal' | 'good' | 'expense' | 'pinned';
  id: string;
  text: string;
  time: number | null; // when it was written; a focus has no time
  /** Where the match is in `text`, for highlighting. */
  start: number;
  length: number;
};

export const SEARCH_RESULTS_MAX = 100;
export const SEARCH_QUERY_MAX = 100;
/** A journal match is shown with this much of its context on each side. */
const SNIPPET_BEFORE = 40;
const SNIPPET_AFTER = 80;

/** A journal entry can be long: show the match with a little context, on one line. */
function snippet(text: string, m: { start: number; length: number }): { text: string; start: number; length: number } {
  const from = Math.max(0, m.start - SNIPPET_BEFORE);
  const to = Math.min(text.length, m.start + m.length + SNIPPET_AFTER);
  const lead = from > 0 ? '…' : '';
  const body = (lead + text.slice(from, to) + (to < text.length ? '…' : '')).replace(/\s/g, ' ');
  return { text: body, start: m.start - from + lead.length, length: m.length };
}

/**
 * Lower-cases and strips accents one character at a time, keeping a map
 * from each folded position back to the original text, so a match found
 * in the folded text can be highlighted in the original ("café" matches
 * "cafe"; "Straße" keeps its own length).
 */
function fold(text: string): { folded: string; map: number[] } {
  let folded = '';
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let c = text[i];
    try {
      c = c.normalize('NFD').replace(/[̀-ͯ]/g, '');
    } catch {
      // No normalize() (some JS engines): accents then simply must match.
    }
    c = c.toLowerCase();
    for (let j = 0; j < c.length; j++) {
      folded += c[j];
      map.push(i);
    }
  }
  map.push(text.length);
  return { folded, map };
}

export function foldQuery(query: string): string {
  return fold(query.trim().slice(0, SEARCH_QUERY_MAX)).folded.replace(/\s+/g, ' ');
}

function match(text: string, needle: string): { start: number; length: number } | null {
  const { folded, map } = fold(text);
  const at = folded.indexOf(needle);
  if (at === -1) return null;
  const start = map[at];
  const end = map[at + needle.length - 1] + 1;
  return { start, length: end - start };
}

/**
 * Every match, newest day first and newest entry first within a day (the
 * day's focus leads). Returns at most `limit` hits, and how many there are
 * in all. An empty query matches nothing.
 */
export function searchDays(
  days: Record<string, DayLog>,
  query: string,
  limit = SEARCH_RESULTS_MAX,
  pinned: Pinned[] = [],
): { hits: SearchHit[]; total: number } {
  const needle = foldQuery(query);
  if (!needle) return { hits: [], total: 0 };
  const hits: SearchHit[] = [];
  let total = 0;
  const push = (h: SearchHit) => {
    total++;
    if (hits.length < limit) hits.push(h);
  };
  // Pinned notes belong to no day; they come first, dated by when they were written.
  for (const p of pinned) {
    const m = match(p.text, needle);
    if (m) push({ date: dateKey(new Date(p.createdAt)), kind: 'pinned', id: p.id, text: p.text, time: p.createdAt, ...m });
  }
  for (const date of Object.keys(days).sort().reverse()) {
    const day = days[date];
    const f = day.focus ? match(day.focus, needle) : null;
    if (f) push({ date, kind: 'focus', id: `focus-${date}`, text: day.focus, time: null, ...f });
    const j = day.journal ? match(day.journal, needle) : null;
    if (j) push({ date, kind: 'journal', id: `journal-${date}`, time: null, ...snippet(day.journal, j) });
    day.gratitude.forEach((g, i) => {
      const m = match(g, needle);
      if (m) push({ date, kind: 'good', id: `good-${date}-${i}`, text: g, time: null, ...m });
    });
    const entries = [
      ...day.notes.map((n) => ({ kind: 'note' as const, id: n.id, text: n.text, time: n.createdAt })),
      ...day.expenses
        .filter((e) => e.label)
        .map((e) => ({ kind: 'expense' as const, id: e.id, text: e.label, time: e.createdAt })),
    ].sort((a, b) => b.time - a.time);
    for (const e of entries) {
      const m = match(e.text, needle);
      if (m) push({ date, ...e, ...m });
    }
  }
  return { hits, total };
}
