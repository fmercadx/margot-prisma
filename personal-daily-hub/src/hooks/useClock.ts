import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { dateKey, msUntilMidnight, msUntilNextMinute } from '../lib/date';

/**
 * The current time, re-rendering on each minute boundary rather than on an
 * interval that drifts. Re-reads the clock when the app returns to the
 * foreground, since timers do not run while it is suspended.
 */
export function useClock(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(new Date());
      timer = setTimeout(tick, msUntilNextMinute() + 50);
    };
    timer = setTimeout(tick, msUntilNextMinute() + 50);

    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      clearTimeout(timer);
      tick();
    });
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, []);

  return now;
}

/**
 * Today's `YYYY-MM-DD` key, which changes at local midnight — so the screen
 * rolls over to a fresh day even if the app is left open overnight.
 *
 * Checks at most a minute apart instead of arming one long timer: Android
 * may defer long timers, and a clock change or time-zone move should be
 * picked up promptly.
 */
export function useToday(): string {
  const [key, setKey] = useState(() => dateKey());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      setKey(dateKey());
      timer = setTimeout(check, Math.min(msUntilMidnight() + 250, 60_000));
    };
    timer = setTimeout(check, Math.min(msUntilMidnight() + 250, 60_000));

    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      clearTimeout(timer);
      check();
    });
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, []);

  return key;
}
