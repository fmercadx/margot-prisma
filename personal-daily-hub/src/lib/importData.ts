// Picks a backup file with the system file chooser (Storage Access
// Framework on Android, the Files sheet on iOS). No storage permission is
// needed: the person grants access to the one file they choose.

import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';

import { IMPORT_MAX_BYTES } from './importJson';

export type PickResult = { kind: 'file'; text: string } | { kind: 'canceled' } | { kind: 'error'; message: string };

export async function pickBackupText(): Promise<PickResult> {
  const res = await DocumentPicker.getDocumentAsync({
    // Providers label .json files inconsistently, so accept any file and
    // let parseBackup decide what it is.
    type: '*/*',
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (res.canceled || !res.assets?.length) return { kind: 'canceled' };
  const asset = res.assets[0];
  if (asset.size !== undefined && asset.size > IMPORT_MAX_BYTES) {
    return { kind: 'error', message: 'That file is too large to be a Daily Hub backup.' };
  }
  const copy = new File(asset.uri);
  try {
    return { kind: 'file', text: await copy.text() };
  } catch {
    return { kind: 'error', message: 'Couldn’t read that file.' };
  } finally {
    // The picker's copy is plain JSON in the cache; don't leave it there.
    try {
      copy.delete();
    } catch {
      // Already gone, or never written.
    }
  }
}
