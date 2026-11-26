// The optional app lock: the phone's own fingerprint, face or PIN prompt,
// via expo-local-authentication. No biometric data ever reaches the app;
// it only learns whether the person passed.
//
// What it protects against is someone picking up your unlocked phone. The
// stored data is protected separately, by encryption (dataCodec.ts), whether
// or not the lock is on.

import * as LocalAuthentication from 'expo-local-authentication';
import * as ScreenCapture from 'expo-screen-capture';
import { Platform } from 'react-native';

export const appLockSupported = Platform.OS === 'ios' || Platform.OS === 'android';

/** Back from the background after this long, the app locks again. */
export const RELOCK_AFTER_MS = 30_000;

export type LockAvailability = 'available' | 'no-device-lock';

/** The app lock leans on the phone's own lock, so it needs one set. */
export async function lockAvailability(): Promise<LockAvailability> {
  const level = await LocalAuthentication.getEnrolledLevelAsync();
  return level === LocalAuthentication.SecurityLevel.NONE ? 'no-device-lock' : 'available';
}

export async function authenticate(promptMessage: string): Promise<boolean> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel: 'Cancel',
      // Fall back to the phone's PIN / pattern / password, so a failed
      // fingerprint never locks the owner out of their own data.
      disableDeviceFallback: false,
    });
    return result.success;
  } catch (err) {
    console.warn('[lock] authentication failed to start', err);
    return false;
  }
}

/**
 * While the lock is on, keep the app's contents out of places a lock screen
 * does not cover. Android: FLAG_SECURE, so the recent-apps preview is blank
 * and screenshots and screen recordings are blocked. iOS: a blur over the
 * app-switcher snapshot.
 */
export async function setPrivacyProtection(on: boolean): Promise<void> {
  try {
    if (on) {
      await ScreenCapture.preventScreenCaptureAsync('app-lock');
      if (Platform.OS === 'ios') await ScreenCapture.enableAppSwitcherProtectionAsync(0.9);
    } else {
      await ScreenCapture.allowScreenCaptureAsync('app-lock');
      if (Platform.OS === 'ios') await ScreenCapture.disableAppSwitcherProtectionAsync();
    }
  } catch (err) {
    console.warn('[lock] could not change screen-capture protection', err);
  }
}
