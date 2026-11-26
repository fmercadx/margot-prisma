import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { appLockSupported, authenticate, RELOCK_AFTER_MS, setPrivacyProtection } from '../lib/appLock';

export type AppLock = {
  /** Show the lock screen instead of the app. */
  locked: boolean;
  /** An unlock prompt is open. */
  busy: boolean;
  unlock: () => Promise<void>;
  /** The person just proved who they are (e.g. to turn the lock on). */
  markUnlocked: () => void;
};

/**
 * Locks the app at launch, and again after it has been in the background
 * for `relockAfterMs` (30 s unless the person chose otherwise), whenever
 * the lock is turned on.
 *
 * `locked` is worked out during render, never in an effect: an effect runs
 * after the first frame, which would draw the day for one frame before the
 * lock screen covered it. Saved settings arrive in the same render that
 * ends loading, so a locked app goes straight from spinner to lock screen.
 *
 * The grace period matters: the share sheet, the system's fingerprint
 * prompt and a quick glance at another app all send this one briefly to
 * the background, and re-locking for those would ask again mid-task.
 */
export function useAppLock(enabled: boolean, relockAfterMs: number = RELOCK_AFTER_MS): AppLock {
  const active = enabled && appLockSupported;
  const relockAfter = useRef(relockAfterMs);
  relockAfter.current = relockAfterMs;
  const [unlocked, setUnlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const backgroundAt = useRef<number | null>(null);

  useEffect(() => {
    void setPrivacyProtection(active);
  }, [active]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background') {
        backgroundAt.current = Date.now();
      } else if (s === 'active') {
        const since = backgroundAt.current;
        backgroundAt.current = null;
        if (since !== null && Date.now() - since >= relockAfter.current) setUnlocked(false);
      }
    });
    return () => sub.remove();
  }, []);

  const unlock = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      if (await authenticate('Unlock Personal Daily Hub')) setUnlocked(true);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  const markUnlocked = useCallback(() => setUnlocked(true), []);

  return { locked: active && !unlocked, busy, unlock, markUnlocked };
}
