// The export file's contents. Pure, so it is tested without a file system.

import { dateKey } from './date';
import { hasAnyData, type Countdown, type DayLog, type Habit, type Settings } from './store';

export const EXPORT_FILE_PREFIX = 'personal-daily-hub-';

export type ExportFile = {
  app: 'Personal Daily Hub';
  format: 1;
  exportedAt: string;
  settings: Pick<Settings, 'waterGoal' | 'reminderHour'>;
  habits: Habit[];
  countdowns: Countdown[];
  days: Record<string, DayLog>;
};

/**
 * Everything the person has logged, newest day last. Empty days are left
 * out. The app-lock and haptics settings are not exported: they describe
 * this phone, not the data.
 */
export function buildExport(
  days: Record<string, DayLog>,
  habits: Habit[],
  settings: Settings,
  now: Date = new Date(),
  countdowns: Countdown[] = [],
): { filename: string; json: string } {
  const kept = Object.keys(days)
    .filter((d) => hasAnyData(days[d]))
    .sort()
    .reduce<Record<string, DayLog>>((acc, d) => ((acc[d] = days[d]), acc), {});
  const file: ExportFile = {
    app: 'Personal Daily Hub',
    format: 1,
    exportedAt: now.toISOString(),
    settings: { waterGoal: settings.waterGoal, reminderHour: settings.reminderHour },
    habits,
    countdowns,
    days: kept,
  };
  return { filename: `${EXPORT_FILE_PREFIX}${dateKey(now)}.json`, json: JSON.stringify(file, null, 2) };
}

/** A protected backup's name says so, so it isn't mistaken for a readable one. */
export function protectedFilename(filename: string): string {
  return filename.replace(/\.json$/, '-protected.json');
}
