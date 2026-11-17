// Web stand-in for exportData.ts: the browser downloads the file instead of
// opening a share sheet.

export async function exportAvailable(): Promise<boolean> {
  return typeof document !== 'undefined';
}

export function removeOldExports(): void {}

export async function shareExport(filename: string, json: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
