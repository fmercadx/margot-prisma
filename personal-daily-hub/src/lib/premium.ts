// The free/premium line, in one place so the UI and the tests agree on it.

export const FREE_NOTES_PER_DAY = 3;
export const PREMIUM_PRICE_LABEL = '$4.99';

/** Why the paywall opened. Drives the sentence at the top of the sheet. */
export type PaywallReason = 'notes' | 'habits' | 'history' | 'upgrade';

export function canAddNote(notesToday: number, isPremium: boolean): boolean {
  return isPremium || notesToday < FREE_NOTES_PER_DAY;
}

/** Custom habits are a premium benefit; the four core habits are free. */
export function canAddCustomHabit(isPremium: boolean): boolean {
  return isPremium;
}

export const PAYWALL_HEADLINES: Record<PaywallReason, string> = {
  notes: `You've captured ${FREE_NOTES_PER_DAY} notes today — the free limit.`,
  habits: 'Custom habits are part of Premium.',
  history: 'Your history is waiting.',
  upgrade: 'Get more out of every day.',
};

/**
 * MOCK purchase. No store is contacted and no money moves; it resolves
 * true after a short pause so the button's busy state is visible.
 *
 * This is the one function to replace for a real release. Digital
 * unlocks inside an iOS or Android app must go through the platform's
 * in-app purchase system (StoreKit / Google Play Billing, or a wrapper
 * such as RevenueCat), and the entitlement should be restored from the
 * store at launch rather than trusted from local storage.
 */
export async function purchasePremiumMock(): Promise<boolean> {
  await new Promise((resolve) => setTimeout(resolve, 600));
  return true;
}
