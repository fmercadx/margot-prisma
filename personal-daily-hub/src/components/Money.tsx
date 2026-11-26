import { createContext, useContext } from 'react';

import { formatCents, formatCentsCompact } from '../lib/money';

/** What every amount reads as while amounts are hidden. */
export const HIDDEN_AMOUNT = '$•••';

const AmountsHidden = createContext(false);

/** Wraps the screen; `value` is the "Hide amounts" setting. */
export const MoneyVisibility = AmountsHidden.Provider;

/**
 * Money formatting that respects "Hide amounts". Every amount of the
 * person's own money on screen goes through this, including spoken labels;
 * prices the app itself shows (the paywall) do not.
 */
export function useMoney() {
  const hidden = useContext(AmountsHidden);
  return {
    hidden,
    money: (cents: number) => (hidden ? HIDDEN_AMOUNT : formatCents(cents)),
    compact: (cents: number) => (hidden ? '•••' : formatCentsCompact(cents)),
  };
}
