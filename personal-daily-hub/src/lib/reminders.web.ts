// Web stand-in for reminders.ts. Metro picks this file for the web build, so
// expo-notifications — which has no scheduled local notifications on the
// web and warns when imported there — is never loaded in a browser.

import type { EnableResult } from './reminders';

export const REMINDER_MINUTE = 0;

export function hourLabel(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12} ${hour < 12 ? 'AM' : 'PM'}`;
}

export const remindersSupported = false;

export async function isReminderScheduled(): Promise<boolean> {
  return false;
}

export async function enableDailyReminder(_hour: number): Promise<EnableResult> {
  return 'unsupported';
}

export async function disableDailyReminder(): Promise<void> {}
