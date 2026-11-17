// Web stand-in for appLock.ts: a browser has no fingerprint prompt the app
// can use, so the lock is hidden on the web demo.

export const appLockSupported = false;
export const RELOCK_AFTER_MS = 30_000;
export type LockAvailability = 'available' | 'no-device-lock';

export async function lockAvailability(): Promise<LockAvailability> {
  return 'no-device-lock';
}

export async function authenticate(): Promise<boolean> {
  return false;
}

export async function setPrivacyProtection(): Promise<void> {}
