// Hands the export file to the phone's share sheet, so the person chooses
// where it goes (Files, Drive, email…). The app itself never sends it
// anywhere, and the release build has no internet access to do so.
//
// The file is plain JSON — readable, and importable elsewhere — so it is
// written to the app's private cache and removed again the next time the
// app starts or exports.

import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { EXPORT_FILE_PREFIX } from './exportJson';

export async function exportAvailable(): Promise<boolean> {
  try {
    return await Sharing.isAvailableAsync();
  } catch {
    return false;
  }
}

/** Deletes earlier export files from the cache. */
export function removeOldExports(): void {
  try {
    for (const entry of (Paths.cache as Directory).list()) {
      if (entry instanceof File && entry.name.startsWith(EXPORT_FILE_PREFIX)) entry.delete();
    }
  } catch (err) {
    console.warn('[export] could not tidy old exports', err);
  }
}

export async function shareExport(filename: string, json: string): Promise<void> {
  removeOldExports();
  const file = new File(Paths.cache, filename);
  file.create({ overwrite: true });
  await file.write(json);
  // Not deleted straight after: on Android the receiving app may still be
  // reading it once this resolves. removeOldExports() runs at next launch.
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/json',
    UTI: 'public.json',
    dialogTitle: 'Export Personal Daily Hub data',
  });
}
