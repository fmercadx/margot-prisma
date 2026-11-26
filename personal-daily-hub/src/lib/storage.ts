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
//
// Every value passes through a Codec on its way in and out. On phones that
// is AES-256-GCM (dataCodec.ts), so the database on disk holds only
// ciphertext; the web demo stores plain JSON.

import AsyncStorage from '@react-native-async-storage/async-storage';

import { DEFAULT_CATEGORY, isBudget, isCategory, MONTHLY_BUDGET_STEPS_CENTS, normalizeCategoryBudgets } from './categories';
import { isSealed, plainCodec, type Codec } from './codec';
import { isDateKey, weekStart } from './date';
import { MAX_EXPENSE_CENTS } from './money';
import {
  BILLS_MAX,
  cleanBill,
  cleanGoal,
  CORE_HABITS,
  GOALS_STORED_MAX,
  sortGoals,
  WEEK_GOALS_MAX,
  type WeekGoal,
  PINNED_MAX,
  sortBills,
  type Bill,
  type Pinned,
  COUNTDOWN_LABEL_MAX_LENGTH,
  COUNTDOWNS_MAX,
  CUSTOM_HABITS_MAX,
  DEFAULT_SETTINGS,
  ENERGY_MAX,
  ENERGY_MIN,
  cleanGratitude,
  GRATITUDE_MAX,
  EXPENSE_LABEL_MAX_LENGTH,
  FOCUS_LENGTHS,
  FOCUS_MAX_LENGTH,
  FOCUS_MINUTES_MAX,
  HOME_CARDS,
  HABIT_MAX_LENGTH,
  JOURNAL_MAX_LENGTH,
  normalizeDays,
  normalizeHomeHidden,
  normalizeHomeOrder,
  MOOD_MAX,
  MOOD_MIN,
  NOTE_MAX_LENGTH,
  RELOCK_CHOICES_SEC,
  REMINDER_HOUR_MAX,
  REMINDER_HOUR_MIN,
  roundSleep,
  SLEEP_MAX,
  sortCountdowns,
  WATER_GOAL_MAX,
  WATER_GOAL_MIN,
  WATER_MAX,
  WIND_DOWN_CHOICES,
  type Countdown,
  type DayLog,
  type Expense,
  type FocusTimer,
  type Habit,
  type Note,
  type Settings,
} from './store';

const PREFIX = 'pdh:v1:';
export const HABITS_KEY = `${PREFIX}habits`;
export const SETTINGS_KEY = `${PREFIX}settings`;
export const COUNTDOWNS_KEY = `${PREFIX}countdowns`;
export const FOCUS_TIMER_KEY = `${PREFIX}focus-timer`;
export const PINNED_KEY = `${PREFIX}pinned`;
export const BILLS_KEY = `${PREFIX}bills`;
export const GOALS_KEY = `${PREFIX}goals`;
const DAY_PREFIX = `${PREFIX}day:`;
export const dayStorageKey = (date: string) => `${DAY_PREFIX}${date}`;
const quarantineKey = (key: string) => `${PREFIX}corrupt:${Date.now()}:${key}`;

// ---- validation -----------------------------------------------------------
//
// The same checks guard two doors: values read back from storage, and a
// backup file someone picks to restore. The second is outside input, so
// every string has a length cap, every list a size cap, and anything that
// does not fit is dropped rather than repaired into something plausible.

/** Longest id accepted; the app's own are about 25 characters. */
const ID_MAX_LENGTH = 64;
/** Per-day ceilings, far above real use, so a hostile file cannot balloon memory. */
export const DAY_ITEMS_MAX = 1000;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isId = (v: unknown): v is string => isStr(v) && v.length > 0 && v.length <= ID_MAX_LENGTH;
const isTime = (v: unknown): v is number => isNum(v) && v > 0 && v < 8.64e15; // a valid Date

function sanitizeNote(v: unknown): Note | null {
  if (!isObj(v) || !isId(v.id) || !isStr(v.text) || !isTime(v.createdAt)) return null;
  const text = v.text.slice(0, NOTE_MAX_LENGTH);
  if (!text.trim()) return null;
  const note: Note = { id: v.id, text, createdAt: v.createdAt };
  if (isTime(v.editedAt)) note.editedAt = v.editedAt;
  if (v.task === true) {
    note.task = true;
    if (isTime(v.doneAt)) note.doneAt = v.doneAt;
    if (isDateKey(v.carriedFrom)) note.carriedFrom = v.carriedFrom;
    if (isDateKey(v.carriedTo)) note.carriedTo = v.carriedTo;
  }
  return note;
}

function sanitizeExpense(v: unknown): Expense | null {
  if (!isObj(v) || !isId(v.id) || !isTime(v.createdAt)) return null;
  if (!Number.isInteger(v.cents) || (v.cents as number) <= 0 || (v.cents as number) > MAX_EXPENSE_CENTS) return null;
  const label = isStr(v.label) ? v.label.slice(0, EXPENSE_LABEL_MAX_LENGTH) : '';
  // Saved before categories existed (1.2 and earlier), or one this build doesn't know.
  const category = isCategory(v.category) ? v.category : DEFAULT_CATEGORY;
  return { id: v.id, cents: v.cents as number, label, category, createdAt: v.createdAt };
}

function list<T>(v: unknown, each: (x: unknown) => T | null, max = DAY_ITEMS_MAX): T[] {
  if (!Array.isArray(v)) return [];
  const out: T[] = [];
  const seen = new Set<string>();
  for (const x of v.slice(0, max)) {
    const item = each(x);
    if (item === null) continue;
    const id = (item as { id?: unknown }).id;
    if (typeof id === 'string') {
      if (seen.has(id)) continue; // one entry per id
      seen.add(id);
    }
    out.push(item);
  }
  return out;
}

const inRange = (v: unknown, lo: number, hi: number): number | null =>
  isNum(v) && v >= lo && v <= hi ? Math.round(v) : null;

export function sanitizeDay(v: unknown): DayLog {
  const o = isObj(v) ? v : {};
  const habitIds = (x: unknown) =>
    Array.isArray(x) ? [...new Set(x.slice(0, CUSTOM_HABITS_MAX + CORE_HABITS.length).filter(isId))] : [];
  const habitsDone = habitIds(o.habitsDone);
  const water = isNum(o.water) ? Math.min(WATER_MAX, Math.max(0, Math.round(o.water))) : 0;
  const focus = isStr(o.focus)
    ? o.focus
        .slice(0, FOCUS_MAX_LENGTH * 4)
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, FOCUS_MAX_LENGTH)
    : '';
  const journal = isStr(o.journal)
    ? o.journal
        .slice(0, JOURNAL_MAX_LENGTH * 2)
        .replace(/\r\n?/g, '\n')
        .trim()
        .slice(0, JOURNAL_MAX_LENGTH)
    : '';
  return {
    focus,
    journal,
    gratitude: Array.isArray(o.gratitude) ? cleanGratitude(o.gratitude.slice(0, GRATITUDE_MAX * 2)) : [],
    notes: list(o.notes, sanitizeNote),
    habitsDone,
    // A habit is done or set aside, not both; done wins.
    habitsSkipped: habitIds(o.habitsSkipped).filter((id) => !habitsDone.includes(id)),
    water,
    energy: inRange(o.energy, ENERGY_MIN, ENERGY_MAX),
    mood: inRange(o.mood, MOOD_MIN, MOOD_MAX),
    sleep: isNum(o.sleep) && o.sleep >= 0 && o.sleep <= SLEEP_MAX ? roundSleep(o.sleep) : null,
    expenses: list(o.expenses, sanitizeExpense),
    focusMinutes: isNum(o.focusMinutes) ? Math.min(FOCUS_MINUTES_MAX, Math.max(0, Math.round(o.focusMinutes))) : 0,
  };
}

export function sanitizeSettings(v: unknown): Settings {
  const o = isObj(v) ? v : {};
  const int = (x: unknown, lo: number, hi: number, fallback: number) =>
    isNum(x) && Number.isInteger(x) && x >= lo && x <= hi ? x : fallback;
  return {
    waterGoal: int(o.waterGoal, WATER_GOAL_MIN, WATER_GOAL_MAX, DEFAULT_SETTINGS.waterGoal),
    reminderHour: int(o.reminderHour, REMINDER_HOUR_MIN, REMINDER_HOUR_MAX, DEFAULT_SETTINGS.reminderHour),
    lockEnabled: o.lockEnabled === true,
    haptics: o.haptics !== false, // on unless switched off
    dailyBudgetCents: isBudget(o.dailyBudgetCents) ? o.dailyBudgetCents : null,
    monthlyBudgetCents: isBudget(o.monthlyBudgetCents, MONTHLY_BUDGET_STEPS_CENTS) ? o.monthlyBudgetCents : null,
    relockAfterSec:
      isNum(o.relockAfterSec) && RELOCK_CHOICES_SEC.includes(o.relockAfterSec)
        ? o.relockAfterSec
        : DEFAULT_SETTINGS.relockAfterSec,
    hideAmounts: o.hideAmounts === true,
    waterReminders: o.waterReminders === true,
    focusLength:
      isNum(o.focusLength) && FOCUS_LENGTHS.includes(o.focusLength) ? o.focusLength : DEFAULT_SETTINGS.focusLength,
    homeOrder: Array.isArray(o.homeOrder)
      ? normalizeHomeOrder(o.homeOrder.slice(0, HOME_CARDS.length * 2))
      : [...HOME_CARDS],
    homeHidden: Array.isArray(o.homeHidden) ? normalizeHomeHidden(o.homeHidden.slice(0, HOME_CARDS.length * 2)) : [],
    mockPremium: o.mockPremium === true,
    windDownAt: isNum(o.windDownAt) && WIND_DOWN_CHOICES.includes(o.windDownAt) ? o.windDownAt : null,
    categoryBudgets: normalizeCategoryBudgets(o.categoryBudgets),
    reviewedWeek: isDateKey(o.reviewedWeek) ? weekStart(o.reviewedWeek) : null,
  };
}

/** Pinned notes: one per id, real times, text capped, at most PINNED_MAX, newest pinned first. */
export function sanitizePinned(v: unknown): Pinned[] {
  return list(
    v,
    (p) => {
      if (!isObj(p) || !isId(p.id) || !isStr(p.text) || !isTime(p.createdAt) || !isTime(p.pinnedAt)) return null;
      const text = p.text.slice(0, NOTE_MAX_LENGTH);
      return text.trim() ? { id: p.id, text, createdAt: p.createdAt, pinnedAt: p.pinnedAt } : null;
    },
    PINNED_MAX * 2,
  )
    .slice(0, PINNED_MAX)
    .sort((a, b) => b.pinnedAt - a.pinnedAt);
}

/** Monthly bills: checked like a typed one, one per id, at most BILLS_MAX, by day. */
export function sanitizeBills(v: unknown): Bill[] {
  return sortBills(
    list(
      v,
      (b) =>
        isObj(b) && isId(b.id) && isStr(b.label) && isNum(b.cents) && isNum(b.day)
          ? cleanBill({
              id: b.id,
              label: b.label.slice(0, EXPENSE_LABEL_MAX_LENGTH * 4),
              cents: b.cents,
              category: (isCategory(b.category) ? b.category : DEFAULT_CATEGORY) as Bill['category'],
              day: b.day,
              lastPosted: isStr(b.lastPosted) ? b.lastPosted.slice(0, 7) : undefined,
            })
          : null,
      BILLS_MAX * 2,
    ).slice(0, BILLS_MAX),
  );
}

/**
 * Weekly goals: text capped, real weeks and times, one per id, at most
 * three a week and GOALS_STORED_MAX in all (the newest kept), newest week first.
 */
export function sanitizeGoals(v: unknown): WeekGoal[] {
  const items = list(
    v,
    (g) =>
      isObj(g) && isId(g.id) && isStr(g.text) && isStr(g.week) && isTime(g.createdAt)
        ? cleanGoal({
            id: g.id,
            text: g.text,
            week: g.week,
            createdAt: g.createdAt,
            doneAt: isTime(g.doneAt) ? g.doneAt : undefined,
          })
        : null,
    GOALS_STORED_MAX * 2,
  );
  const perWeek = new Map<string, number>();
  const out: WeekGoal[] = [];
  for (const g of sortGoals(items)) {
    const n = perWeek.get(g.week) ?? 0;
    if (n >= WEEK_GOALS_MAX) continue;
    perWeek.set(g.week, n + 1);
    out.push(g);
  }
  return out.slice(0, GOALS_STORED_MAX);
}

/** A running focus session: a real day, and no longer than the longest session. */
export function sanitizeFocusTimer(v: unknown): FocusTimer | null {
  if (!isObj(v) || !isDateKey(v.date) || !isTime(v.startedAt) || !isTime(v.endsAt)) return null;
  const length = v.endsAt - v.startedAt;
  if (length <= 0 || length > Math.max(...FOCUS_LENGTHS) * 60_000) return null;
  return { date: v.date, startedAt: v.startedAt, endsAt: v.endsAt };
}

/** A stored schedule, or undefined for every day (and for anything invalid). */
function sanitizeDays(v: unknown): number[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return normalizeDays(v.slice(0, 7)) ?? undefined;
}

const withDays = (h: Habit, days: number[] | undefined): Habit => (days ? { ...h, days } : h);
const withSince = (h: Habit, since: unknown): Habit => (isDateKey(since) ? { ...h, since } : h);

/**
 * Custom habits from storage, with the four core habits always present.
 * A core habit is stored as `{ id, core: true, days? }`; its name is the
 * app's. Since 1.8 all four are stored, in the order the person chose;
 * before that only scheduled ones were, and the core four came first.
 */
export function sanitizeHabits(v: unknown): Habit[] {
  const raw = Array.isArray(v) ? v.slice(0, CUSTOM_HABITS_MAX * 2 + CORE_HABITS.length) : [];
  const coreDays = new Map<string, number[] | undefined>();
  for (const h of raw) {
    if (!isObj(h) || h.core !== true || !isId(h.id) || coreDays.has(h.id)) continue;
    if (CORE_HABITS.some((c) => c.id === h.id)) coreDays.set(h.id, sanitizeDays(h.days));
  }
  const custom = list(
    raw,
    (h) =>
      isObj(h) && isId(h.id) && isStr(h.label) && h.core !== true && h.label.trim()
        ? withSince(
            withDays({ id: h.id, label: h.label.trim().slice(0, HABIT_MAX_LENGTH), core: false }, sanitizeDays(h.days)),
            h.since,
          )
        : null,
    CUSTOM_HABITS_MAX * 2,
  )
    .filter((h) => !CORE_HABITS.some((c) => c.id === h.id))
    .slice(0, CUSTOM_HABITS_MAX);
  const core = (id: string) => {
    const c = CORE_HABITS.find((x) => x.id === id)!;
    return withDays(c, coreDays.get(c.id));
  };
  if (coreDays.size < CORE_HABITS.length) return [...CORE_HABITS.map((c) => core(c.id)), ...custom];
  // Saved in order: keep it.
  const keep = new Set(custom.map((h) => h.id));
  const out: Habit[] = [];
  const placed = new Set<string>();
  for (const h of raw) {
    if (!isObj(h) || !isId(h.id) || placed.has(h.id)) continue;
    if (h.core === true && coreDays.has(h.id)) out.push(core(h.id));
    else if (keep.has(h.id)) out.push(custom.find((c) => c.id === h.id)!);
    else continue;
    placed.add(h.id);
  }
  return out;
}

/** Countdowns: real dates, a name, one per id, at most COUNTDOWNS_MAX, soonest first. */
export function sanitizeCountdowns(v: unknown): Countdown[] {
  return sortCountdowns(
    list(
      v,
      (c) => {
        if (!isObj(c) || !isId(c.id) || !isStr(c.label) || !isDateKey(c.date)) return null;
        const label = c.label.replace(/\s+/g, ' ').trim().slice(0, COUNTDOWN_LABEL_MAX_LENGTH);
        return label ? { id: c.id, label, date: c.date } : null;
      },
      COUNTDOWNS_MAX * 2,
    ).slice(0, COUNTDOWNS_MAX),
  );
}

// ---- the codec ------------------------------------------------------------

let codec: Codec = plainCodec;

/** Set once at launch, before anything is read or written. */
export function setCodec(c: Codec) {
  codec = c;
}

export function isEncrypted(): boolean {
  return codec.encrypted;
}

/**
 * Re-writes any value still stored as plain JSON (version 1.0 kept
 * everything that way) in sealed form. Runs at launch before anything is
 * read; once everything is sealed it reads the keys and writes nothing.
 * Returns how many values it sealed.
 */
export async function ensureSealed(): Promise<number> {
  if (!codec.encrypted) return 0;
  const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIX));
  if (keys.length === 0) return 0;
  const updates: [string, string][] = [];
  for (const [key, value] of await AsyncStorage.multiGet(keys)) {
    if (value !== null && !isSealed(value)) updates.push([key, await codec.seal(key, value)]);
  }
  if (updates.length > 0) await AsyncStorage.multiSet(updates);
  return updates.length;
}

// ---- reading --------------------------------------------------------------

/**
 * Opens and parses a stored value. One that cannot be decrypted (tampered
 * with, or sealed under a key this install no longer has) or is not valid
 * JSON is copied aside, as stored, before it can be overwritten.
 */
async function parse(key: string, raw: string | null): Promise<unknown> {
  if (raw === null) return undefined;
  try {
    return JSON.parse(await codec.open(key, raw));
  } catch (err) {
    console.warn(`[storage] ${key} could not be read; keeping a copy and starting it fresh`, err);
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

export async function loadCountdowns(): Promise<Countdown[]> {
  const raw = await AsyncStorage.getItem(COUNTDOWNS_KEY);
  return sanitizeCountdowns(await parse(COUNTDOWNS_KEY, raw));
}

export async function loadFocusTimer(): Promise<FocusTimer | null> {
  const raw = await AsyncStorage.getItem(FOCUS_TIMER_KEY);
  return sanitizeFocusTimer(await parse(FOCUS_TIMER_KEY, raw));
}

export async function loadPinned(): Promise<Pinned[]> {
  return sanitizePinned(await parse(PINNED_KEY, await AsyncStorage.getItem(PINNED_KEY)));
}

export async function loadBills(): Promise<Bill[]> {
  return sanitizeBills(await parse(BILLS_KEY, await AsyncStorage.getItem(BILLS_KEY)));
}

export async function loadGoals(): Promise<WeekGoal[]> {
  return sanitizeGoals(await parse(GOALS_KEY, await AsyncStorage.getItem(GOALS_KEY)));
}

export async function loadSettings(): Promise<Settings> {
  const raw = await AsyncStorage.getItem(SETTINGS_KEY);
  return sanitizeSettings(await parse(SETTINGS_KEY, raw));
}

/** Every day that has anything stored, for export. */
export async function loadAllDays(): Promise<Record<string, DayLog>> {
  const dates = (await AsyncStorage.getAllKeys())
    .filter((k) => k.startsWith(DAY_PREFIX))
    .map((k) => k.slice(DAY_PREFIX.length))
    .sort();
  return loadDays(dates);
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

// ---- erasing --------------------------------------------------------------

/**
 * Removes every value the app has stored: days, habits, settings, and any
 * quarantined copies. Keys outside the app's prefix are left alone.
 */
export async function eraseStoredData(): Promise<number> {
  const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIX));
  if (keys.length > 0) await AsyncStorage.multiRemove(keys);
  return keys.length;
}

// ---- writing --------------------------------------------------------------

export type Persister = {
  /** Queue a value; it is written after a short pause, coalescing bursts. */
  schedule(key: string, value: unknown): void;
  /** Write everything queued now — call when the app is backgrounded. */
  flush(): Promise<void>;
  /** Stop the timer. Queued values are flushed first. */
  dispose(): Promise<void>;
  /**
   * Drop everything queued without writing it, and resolve once any write
   * already under way has landed. Used before erasing, so nothing sealed
   * with the old key can arrive after the erase.
   */
  discard(): Promise<void>;
};

/**
 * Debounces, encrypts and serialises writes. A slider drag or quick tapping produces
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
  // Bumped by discard(), so a write that fails afterwards is not re-queued.
  let generation = 0;

  const flush = (): Promise<void> => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending.size === 0) return chain;
    const batch = [...pending.entries()];
    const gen = generation;
    pending.clear();
    chain = chain.then(async () => {
      if (gen !== generation) return; // discarded before it started
      try {
        // Sealed here, at write time, so a burst of edits is encrypted once.
        const sealed = await Promise.all(
          batch.map(async ([key, json]): Promise<[string, string]> => [key, await codec.seal(key, json)]),
        );
        await AsyncStorage.multiSet(sealed);
        opts.onSaved?.();
      } catch (err) {
        if (gen !== generation) return;
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
    discard() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      pending.clear();
      generation++;
      return chain;
    },
  };
}

/**
 * Every habit in the order shown: custom habits in full, a core habit as
 * its id and schedule, since its name is part of the app.
 */
type StoredHabit = Habit | { id: string; core: true; days?: number[] };

export function habitsForStorage(habits: Habit[]): StoredHabit[] {
  return habits.map(
    (h): StoredHabit => (!h.core ? h : h.days ? { id: h.id, core: true, days: h.days } : { id: h.id, core: true }),
  );
}
