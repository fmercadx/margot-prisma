// Reading and writing the hub to AsyncStorage.
//
// One key per day (`pdh:v1:day:2026-11-08`) rather than one growing blob:
//  - a write touches only the day that changed, so it stays small and fast
//    however long the app has been in use;
//  - a corrupt value costs one day, not the whole history;
//  - Android's per-value size ceiling is never approached.
//
// Everything read back is validated field by field. Storage is outside the
// type system: an older build, a bug, or a half-finished write can leave
// anything there, and a bad value must not crash the app on launch.

import AsyncStorage from '@react-native-async-storage/async-storage';

import { isDateKey } from './date';
import {
  CORE_HABITS,
  ENERGY_MAX,
  ENERGY_MIN,
  WATER_MAX,
  type DayLog,
  type Expense,
  type Habit,
  type Note,
} from './store';

const PREFIX = 'pdh:v1:';
export const HABITS_KEY = `${PREFIX}habits`;
export const dayStorageKey = (date: string) => `${PREFIX}day:${date}`;
const quarantineKey = (key: string) => `${PREFIX}corrupt:${Date.now()}:${key}`;

// ---- validation -----------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function sanitizeNote(v: unknown): Note | null {
  if (!isObj(v) || !isStr(v.id) || !isStr(v.text) || !isNum(v.createdAt)) return null;
  return { id: v.id, text: v.text, createdAt: v.createdAt };
}

function sanitizeExpense(v: unknown): Expense | null {
  if (!isObj(v) || !isStr(v.id) || !isNum(v.createdAt)) return null;
  if (!Number.isInteger(v.cents) || (v.cents as number) <= 0) return null;
  return { id: v.id, cents: v.cents as number, label: isStr(v.label) ? v.label : '', createdAt: v.createdAt };
}

function list<T>(v: unknown, each: (x: unknown) => T | null): T[] {
  return Array.isArray(v) ? v.map(each).filter((x): x is T => x !== null) : [];
}

export function sanitizeDay(v: unknown): DayLog {
  const o = isObj(v) ? v : {};
  const water = isNum(o.water) ? Math.min(WATER_MAX, Math.max(0, Math.round(o.water))) : 0;
  const energy =
    isNum(o.energy) && o.energy >= ENERGY_MIN && o.energy <= ENERGY_MAX ? Math.round(o.energy) : null;
  return {
    notes: list(o.notes, sanitizeNote),
    habitsDone: Array.isArray(o.habitsDone) ? [...new Set(o.habitsDone.filter(isStr))] : [],
    water,
    energy,
    expenses: list(o.expenses, sanitizeExpense),
  };
}

/** Custom habits from storage, with the four core habits always present. */
export function sanitizeHabits(v: unknown): Habit[] {
  const custom = list(v, (h) =>
    isObj(h) && isStr(h.id) && isStr(h.label) && h.core !== true && h.label.trim()
      ? { id: h.id, label: h.label, core: false }
      : null,
  ).filter((h) => !CORE_HABITS.some((c) => c.id === h.id));
  return [...CORE_HABITS, ...custom];
}

// ---- reading --------------------------------------------------------------

/** Parses a stored value; a corrupt one is copied aside before it is lost. */
async function parse(key: string, raw: string | null): Promise<unknown> {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[storage] ${key} is not valid JSON; keeping a copy and starting it fresh`, err);
    try {
      await AsyncStorage.setItem(quarantineKey(key), raw);
    } catch {
      // Best effort: the copy is a courtesy, not something to fail launch over.
    }
    return undefined;
  }
}

export async function loadHabits(): Promise<Habit[]> {
  const raw = await AsyncStorage.getItem(HABITS_KEY);
  return sanitizeHabits(await parse(HABITS_KEY, raw));
}

/** Loads the given days. Days with nothing stored are left out. */
export async function loadDays(dates: string[]): Promise<Record<string, DayLog>> {
  const valid = dates.filter(isDateKey);
  if (valid.length === 0) return {};
  const pairs = await AsyncStorage.multiGet(valid.map(dayStorageKey));
  const days: Record<string, DayLog> = {};
  for (let i = 0; i < pairs.length; i++) {
    const [key, raw] = pairs[i];
    if (raw === null) continue;
    const value = await parse(key, raw);
    if (value !== undefined) days[valid[i]] = sanitizeDay(value);
  }
  return days;
}

// ---- writing --------------------------------------------------------------

export type Persister = {
  /** Queue a value; it is written after a short pause, coalescing bursts. */
  schedule(key: string, value: unknown): void;
  /** Write everything queued now — call when the app is backgrounded. */
  flush(): Promise<void>;
  /** Stop the timer. Queued values are flushed first. */
  dispose(): Promise<void>;
};

/**
 * Debounces and serialises writes. A slider drag or quick tapping produces
 * a burst of changes; this turns each burst into one `multiSet`, and chains
 * writes so an older value can never land after a newer one.
 *
 * A failed write is re-queued (unless a newer value for that key arrived
 * meanwhile) and retried on the next flush, and `onError` is told so the UI
 * can say changes are not being saved.
 */
export function createPersister(
  opts: { delayMs?: number; onError?: (err: unknown) => void; onSaved?: () => void } = {},
): Persister {
  const delayMs = opts.delayMs ?? 300;
  const pending = new Map<string, string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<void> = Promise.resolve();

  const flush = (): Promise<void> => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending.size === 0) return chain;
    const batch = [...pending.entries()];
    pending.clear();
    chain = chain.then(async () => {
      try {
        await AsyncStorage.multiSet(batch);
        opts.onSaved?.();
      } catch (err) {
        for (const [key, value] of batch) if (!pending.has(key)) pending.set(key, value);
        opts.onError?.(err);
      }
    });
    return chain;
  };

  return {
    schedule(key, value) {
      pending.set(key, JSON.stringify(value));
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void flush(), delayMs);
    },
    flush,
    dispose: flush,
  };
}

/** Only custom habits are stored; the core four are part of the app. */
export function habitsForStorage(habits: Habit[]): Habit[] {
  return habits.filter((h) => !h.core);
}
