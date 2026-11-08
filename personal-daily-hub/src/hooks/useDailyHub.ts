import { useEffect, useReducer, useRef, useState, type Dispatch } from 'react';
import { AppState } from 'react-native';

import { lastNDays } from '../lib/date';
import {
  createPersister,
  dayStorageKey,
  HABITS_KEY,
  habitsForStorage,
  loadDays,
  loadHabits,
  type Persister,
} from '../lib/storage';
import { initialState, reducer, type Action, type DayLog, type Habit, type HubState } from '../lib/store';

/** Days kept in memory for the history charts, today included. */
export const HISTORY_DAYS = 7;

export type DailyHub = {
  state: HubState;
  dispatch: Dispatch<Action>;
  ready: boolean;
  /** Saved data could not be read. Writing is switched off so nothing is overwritten. */
  loadFailed: boolean;
  /** The most recent write failed; it will be retried. */
  saveFailed: boolean;
};

/**
 * The hub's state, loaded from and saved to AsyncStorage.
 *
 * Three rules keep stored data safe:
 *  1. Nothing is written until the first load has finished, so an empty
 *     initial state can never overwrite saved data.
 *  2. Only what changed is written: each day's object is compared by
 *     reference with the one last queued, so loading writes nothing.
 *  3. If the first load fails, writing stays off for the session.
 */
export function useDailyHub(today: string): DailyHub {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  // What was last handed to the persister, per key.
  const queued = useRef<{ habits: Habit[] | null; days: Record<string, DayLog> }>({
    habits: null,
    days: {},
  });
  const loadedFor = useRef<string | null>(null);

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
      let habits: Habit[] | null = null;
      let days: Record<string, DayLog> = {};
      try {
        [habits, days] = await Promise.all([loadHabits(), loadDays(lastNDays(today, HISTORY_DAYS))]);
      } catch (err) {
        console.warn('[storage] could not read saved data', err);
      }
      if (cancelled) return;
      if (habits === null) {
        setLoadFailed(true);
        setReady(true);
        return;
      }
      queued.current = { habits, days: { ...days } };
      loadedFor.current = today;
      dispatch({ type: 'hydrate', habits, days });
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
    loadDays(lastNDays(today, HISTORY_DAYS))
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
    if (!ready || loadFailed) return;
    const p = persister.current!;
    if (state.habits !== queued.current.habits) {
      p.schedule(HABITS_KEY, habitsForStorage(state.habits));
      queued.current.habits = state.habits;
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

  return { state, dispatch, ready, loadFailed, saveFailed };
}
