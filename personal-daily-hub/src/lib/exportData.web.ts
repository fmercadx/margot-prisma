// Web stand-in for exportData.ts: the browser downloads the file instead of
// opening a share sheet.

export async function exportAvailable(): Promise<boolean> {
  return typeof document !== 'undefined';
}

export function removeOldExports(): void {}

export async function shareExport(filename: string, content: string, kind: 'json' | 'csv' = 'json'): Promise<void> {
  const type = kind === 'csv' ? 'text/csv;charset=utf-8' : 'application/json';
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
