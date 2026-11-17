// Web stand-in for importData.ts: the browser's own file chooser.

import * as DocumentPicker from 'expo-document-picker';

import { IMPORT_MAX_BYTES } from './importJson';

export type PickResult = { kind: 'file'; text: string } | { kind: 'canceled' } | { kind: 'error'; message: string };

export async function pickBackupText(): Promise<PickResult> {
  const res = await DocumentPicker.getDocumentAsync({ type: 'application/json', multiple: false });
  if (res.canceled || !res.assets?.length) return { kind: 'canceled' };
  const file = res.assets[0].file;
  if (!file) return { kind: 'error', message: 'Couldn’t read that file.' };
  if (file.size > IMPORT_MAX_BYTES) return { kind: 'error', message: 'That file is too large to be a Daily Hub backup.' };
  try {
    return { kind: 'file', text: await file.text() };
  } catch {
    return { kind: 'error', message: 'Couldn’t read that file.' };
  }
}
