// RFC 4180-ish CSV: quote when a cell holds a comma, quote or newline.

export function toCsv(rows) {
  return rows
    .map((r) => r.map((cell) => {
      const s = cell == null ? '' : String(cell);
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(','))
    .join('\r\n') + '\r\n';
}
