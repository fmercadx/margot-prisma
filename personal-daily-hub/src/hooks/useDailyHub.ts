import { useCallback, useEffect, useReducer, useRef, useState, type Dispatch } from 'react';
import { AppState } from 'react-native';

import { createDataCodec, destroyDataKey } from '../lib/dataCodec';
import { lastNDays } from '../lib/date';
import {
  COUNTDOWNS_KEY,
  createPersister,
  dayStorageKey,
  ensureSealed,
  eraseStoredData,
  HABITS_KEY,
  habitsForStorage,
  isEncrypted,
  loadCountdowns,
  loadDays,
  loadHabits,
  loadSettings,
  setCodec,
  SETTINGS_KEY,
  type Persister,
} from '../lib/storage';
import {
  CORE_HABITS,
  DEFAULT_SETTINGS,
  initialState,
  reducer,
  type Action,
  type Countdown,
  type DayLog,
  type Habit,
  type HubState,
  type Settings,
} from '../lib/store';

/** Days shown in the history charts, today included. */
export const HISTORY_DAYS = 7;
/** Days kept in memory: enough for the charts and for habit streaks. */
export const LOADED_DAYS = 60;

export type DailyHub = {
  state: HubState;
  dispatch: Dispatch<Action>;
  ready: boolean;
  /** Saved data could not be read. Writing is switched off so nothing is overwritten. */
  loadFailed: boolean;
  /** The most recent write failed; it will be retried. */
  saveFailed: boolean;
  /** Stored data is encrypted on this device (true on phones, false on web). */
  encrypted: boolean;
  /**
   * Deletes everything the app has stored and destroys the encryption key,
   * then starts fresh. Rejects if any step fails; saving is then switched
   * off for the session, since the old key may already be gone.
   */
  erase: () => Promise<void>;
};

/**
 * The hub's state, loaded from and saved to AsyncStorage.
 *
 * Launch order: get the encryption key, seal anything still stored as plain
 * JSON by version 1.0, then read. Three rules keep stored data safe:
 *  1. Nothing is written until the first load has finished, so an empty
 *     initial state can never overwrite saved data.
 *  2. Only what changed is written: each object is compared by reference
 *     with the one last queued, so loading writes nothing.
 *  3. If any launch step fails — including reading the key — writing stays
 *     off for the session.
 */
export function useDailyHub(today: string): DailyHub {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  // What was last handed to the persister, per key.
  const queued = useRef<{
    habits: Habit[] | null;
    settings: Settings | null;
    countdowns: Countdown[] | null;
    days: Record<string, DayLog>;
  }>({
    habits: null,
    settings: null,
    countdowns: null,
    days: {},
  });
  const loadedFor = useRef<string | null>(null);
  const erasing = useRef(false);

  const persister = useRef<Persister | null>(null);
  if (persister.current === null) {
    persister.current = createPersister({
      onError: (err) => {
        console.warn('[storage] write failed; will retry', err);
        setSaveFailed(true);
      },
      onSaved: () => setSaveFailed(false),
    });
  }

  // First load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let loaded: { habits: Habit[]; days: Record<string, DayLog>; settings: Settings; countdowns: Countdown[] } | null =
        null;
      try {
        setCodec(await createDataCodec());
        const sealed = await ensureSealed();
        if (sealed > 0) console.info(`[storage] encrypted ${sealed} values saved by an earlier version`);
        const [habits, days, settings, countdowns] = await Promise.all([
          loadHabits(),
          loadDays(lastNDays(today, LOADED_DAYS)),
          loadSettings(),
          loadCountdowns(),
        ]);
        loaded = { habits, days, settings, countdowns };
      } catch (err) {
        console.warn('[storage] could not read saved data', err);
      }
      if (cancelled) return;
      if (loaded === null) {
        setLoadFailed(true);
        setReady(true);
        return;
      }
      queued.current = {
        habits: loaded.habits,
        settings: loaded.settings,
        countdowns: loaded.countdowns,
        days: { ...loaded.days },
      };
      loadedFor.current = today;
      dispatch({ type: 'hydrate', ...loaded });
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
    // Runs once; later date changes are handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Midnight passed while the app was open: pull in the new history window.
  useEffect(() => {
    if (!ready || loadFailed || loadedFor.current === today) return;
    loadedFor.current = today;
    let cancelled = false;
    loadDays(lastNDays(today, LOADED_DAYS))
      .then((days) => {
        if (cancelled) return;
        for (const [date, day] of Object.entries(days)) {
          if (!(date in queued.current.days)) queued.current.days[date] = day;
        }
        dispatch({ type: 'mergeDays', days });
      })
      .catch((err) => console.warn('[storage] could not load history', err));
    return () => {
      cancelled = true;
    };
  }, [today, ready, loadFailed]);

  // Save whatever changed.
  useEffect(() => {
    if (!ready || loadFailed || erasing.current) return;
    const p = persister.current!;
    if (state.habits !== queued.current.habits) {
      p.schedule(HABITS_KEY, habitsForStorage(state.habits));
      queued.current.habits = state.habits;
    }
    if (state.settings !== queued.current.settings) {
      p.schedule(SETTINGS_KEY, state.settings);
      queued.current.settings = state.settings;
    }
    if (state.countdowns !== queued.current.countdowns) {
      p.schedule(COUNTDOWNS_KEY, state.countdowns);
      queued.current.countdowns = state.countdowns;
    }
    for (const [date, day] of Object.entries(state.days)) {
      if (queued.current.days[date] !== day) {
        p.schedule(dayStorageKey(date), day);
        queued.current.days[date] = day;
      }
    }
  }, [state, ready, loadFailed]);

  // Write immediately when the app is backgrounded; it may be killed there.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') void persister.current?.flush();
    });
    return () => {
      sub.remove();
      void persister.current?.dispose();
    };
  }, []);

  // Order matters. Queued writes are dropped and any write in flight is
  // waited out, so nothing sealed with the old key lands afterwards. The
  // data goes before the key: if deleting the key failed, nothing readable
  // would be left behind for it to open. Only then is a new key made.
  const erase = useCallback(async () => {
    erasing.current = true;
    try {
      await persister.current!.discard();
      await eraseStoredData();
      await destroyDataKey();
      setCodec(await createDataCodec());
    } catch (err) {
      setLoadFailed(true);
      throw err;
    } finally {
      erasing.current = false;
    }
    // Fresh state, marked as already saved, so erasing writes nothing back.
    const fresh = { habits: [...CORE_HABITS], days: {}, settings: DEFAULT_SETTINGS, countdowns: [] as Countdown[] };
    queued.current = { habits: fresh.habits, settings: fresh.settings, countdowns: fresh.countdowns, days: {} };
    loadedFor.current = today;
    dispatch({ type: 'hydrate', ...fresh });
    setLoadFailed(false);
    setSaveFailed(false);
  }, [today]);

  return {
    state,
    dispatch,
    ready,
    loadFailed,
    saveFailed,
    encrypted: ready && !loadFailed && isEncrypted(),
    erase,
  };
}
