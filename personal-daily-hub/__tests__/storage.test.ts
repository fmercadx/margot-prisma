import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  createPersister,
  dayStorageKey,
  HABITS_KEY,
  loadDays,
  loadHabits,
  sanitizeDay,
  sanitizeSettings,
} from '../src/lib/storage';
import { CORE_HABITS } from '../src/lib/store';

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

test('sanitizeDay turns anything into a valid day', () => {
  expect(sanitizeDay(null)).toEqual({ focus: '', notes: [], habitsDone: [], water: 0, energy: null, mood: null, expenses: [] });
  expect(
    sanitizeDay({
      notes: [{ id: 'n', text: 'ok', createdAt: 1 }, { id: 2 }, 'junk'],
      habitsDone: ['a', 'a', 7],
      water: 99.4,
      energy: 11,
      mood: 4,
      expenses: [{ id: 'e', cents: 250, createdAt: 1 }, { id: 'f', cents: 2.5, createdAt: 1 }],
    }),
  ).toEqual({
    focus: '',
    notes: [{ id: 'n', text: 'ok', createdAt: 1 }],
    habitsDone: ['a'],
    water: 20,
    energy: null,
    mood: 4,
    expenses: [{ id: 'e', cents: 250, label: '', category: 'other', createdAt: 1 }],
  });
});

test('sanitizeDay caps what a hostile value could carry', () => {
  const day = sanitizeDay({
    notes: [
      { id: 'n1', text: 'x'.repeat(10_000), createdAt: 1, editedAt: 2 },
      { id: 'n1', text: 'duplicate id', createdAt: 1 },
      { id: 'y'.repeat(500), text: 'id too long', createdAt: 1 },
      { id: 'n2', text: '   ', createdAt: 1 },
      { id: 'n3', text: 'bad time', createdAt: 9e99 },
    ],
    expenses: [
      { id: 'e1', cents: 100_000_001, createdAt: 1 }, // over $1M
      { id: 'e2', cents: 500, label: 'z'.repeat(200), createdAt: 1 },
    ],
    mood: 9,
  });
  expect(day.notes).toHaveLength(1);
  expect(day.notes[0].text).toHaveLength(500);
  expect(day.notes[0].editedAt).toBe(2);
  expect(day.expenses.map((e) => e.id)).toEqual(['e2']);
  expect(day.expenses[0].label).toHaveLength(40);
  expect(day.mood).toBeNull();

  const many = sanitizeDay({ notes: Array.from({ length: 5000 }, (_, i) => ({ id: `n${i}`, text: 't', createdAt: 1 })) });
  expect(many.notes).toHaveLength(1000);
});

test('sanitizeSettings: haptics are on unless switched off', () => {
  expect(sanitizeSettings({}).haptics).toBe(true);
  expect(sanitizeSettings({ haptics: false }).haptics).toBe(false);
  expect(sanitizeSettings({ haptics: 'no' }).haptics).toBe(true);
});

test('habits always include the core four, whatever storage holds', async () => {
  expect(await loadHabits()).toEqual(CORE_HABITS);

  await AsyncStorage.setItem(
    HABITS_KEY,
    JSON.stringify([
      { id: 'x', label: 'Stretch', core: false },
      { id: CORE_HABITS[0].id, label: 'Hijacked core', core: false },
      { id: 'y', label: '', core: false },
    ]),
  );
  const habits = await loadHabits();
  expect(habits.map((h) => h.label)).toEqual([...CORE_HABITS.map((h) => h.label), 'Stretch']);
});

test('loadDays reads one key per day and skips days with nothing stored', async () => {
  await AsyncStorage.setItem(dayStorageKey('2026-11-07'), JSON.stringify({ water: 3 }));
  const days = await loadDays(['2026-11-06', '2026-11-07', 'not-a-date']);
  expect(Object.keys(days)).toEqual(['2026-11-07']);
  expect(days['2026-11-07'].water).toBe(3);
});

test('a corrupt day is copied aside, not silently lost', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  await AsyncStorage.setItem(dayStorageKey('2026-11-07'), '{"water": 3,');
  const days = await loadDays(['2026-11-07']);
  expect(days).toEqual({});
  const keys = await AsyncStorage.getAllKeys();
  const quarantined = keys.find((k) => k.includes('corrupt') && k.endsWith(dayStorageKey('2026-11-07')));
  expect(quarantined).toBeDefined();
  expect(await AsyncStorage.getItem(quarantined!)).toBe('{"water": 3,');
  warn.mockRestore();
});

describe('persister', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('coalesces a burst into one write with the latest values', async () => {
    const p = createPersister({ delayMs: 300 });
    for (let i = 1; i <= 10; i++) p.schedule('k', { water: i });
    p.schedule('other', 'x');
    expect(AsyncStorage.multiSet).not.toHaveBeenCalled();

    jest.advanceTimersByTime(300);
    await p.flush();
    expect(AsyncStorage.multiSet).toHaveBeenCalledTimes(1);
    expect(JSON.parse((await AsyncStorage.getItem('k'))!)).toEqual({ water: 10 });
    expect(JSON.parse((await AsyncStorage.getItem('other'))!)).toBe('x');
  });

  test('flush writes immediately (used when the app is backgrounded)', async () => {
    const p = createPersister({ delayMs: 10_000 });
    p.schedule('k', 1);
    await p.flush();
    expect(await AsyncStorage.getItem('k')).toBe('1');
  });

  test('a failed write is retried, and a newer value is never overwritten by it', async () => {
    const onError = jest.fn();
    const p = createPersister({ delayMs: 300, onError });
    (AsyncStorage.multiSet as jest.Mock).mockRejectedValueOnce(new Error('disk full'));

    p.schedule('k', 'old');
    await p.flush();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(await AsyncStorage.getItem('k')).toBeNull();

    // The retry goes out with the next flush.
    await p.flush();
    expect(await AsyncStorage.getItem('k')).toBe('"old"');

    // Fail again, but queue a newer value before retrying: the newer one wins.
    (AsyncStorage.multiSet as jest.Mock).mockRejectedValueOnce(new Error('disk full'));
    p.schedule('k', 'v2');
    const failing = p.flush();
    p.schedule('k', 'v3');
    await failing;
    await p.flush();
    expect(await AsyncStorage.getItem('k')).toBe('"v3"');
  });
});
