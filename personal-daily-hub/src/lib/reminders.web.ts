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

export async function scheduleFocusEnd(_endsAt: number, _minutes: number): Promise<EnableResult> {
  return 'unsupported';
}

export async function cancelFocusEnd(): Promise<void> {}

export const WATER_REMINDER_HOURS: readonly number[] = [10, 12, 14, 16, 18];
export const WATER_REMINDER_DAYS = 7;

export function waterReminderTimes(_now: Date, _goalMetToday: boolean): Date[] {
  return [];
}

export async function scheduleWaterReminders(_now: Date, _goalMetToday: boolean): Promise<EnableResult> {
  return 'unsupported';
}

export async function cancelWaterReminders(): Promise<void> {}

export function minutesLabel(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export async function scheduleWindDown(_minutes: number): Promise<EnableResult> {
  return 'unsupported';
}

export async function cancelWindDown(): Promise<void> {}
