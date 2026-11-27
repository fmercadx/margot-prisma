// The plant schedule: the table on the sheet (or another sheet of the set)
// that lists each plant with its quantity. It is the designer's own count,
// so a legend symbol counted on the plan can be checked against it.
//
// A schedule row is a text line with several words that ends in a whole
// number. A legend entry matches a row when the row contains the entry's
// name, or starts with the entry's code followed by its name.

function norm(s) {
  return s.toUpperCase().replace(/[’‘'"“”`]/g, '').replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * @param {{rows: Row[], page: number}[]} pages   whole baselines, from textRows
 * @returns {Row[]}  Row: { text, qty, page }
 */
export function parseSchedule(pages) {
  const rows = [];
  for (const { rows: lines, page } of pages) {
    for (const ln of lines) {
      // The quantity is a whole number at the end of the row, or one followed
      // by a wide gap: a legend or a note beside the table can share the
      // baseline and tag its own words onto the row.
      let found = null;
      if (ln.words) {
        const ws = ln.words;
        for (let i = 1; i < ws.length; i++) {
          const w = ws[i];
          if (!/^\d{1,4}$/.test(w.str.trim())) continue;
          const next = ws[i + 1];
          if (next && next.x0 - w.x1 <= 3 * ln.h) continue;
          found = { text: ws.slice(0, i).map((x) => x.str).join(' ').replace(/\s+/g, ' ').trim(), qty: +w.str.trim() };
        }
      } else {
        const m = ln.str.match(/^(.*\S)\s+(\d{1,4})$/);
        if (m) found = { text: m[1], qty: +m[2] };
      }
      if (!found) continue;
      if (found.text.split(/\s+/).length < 2 || !/[A-Za-z]{3}/.test(found.text)) continue;
      rows.push({ ...found, page });
    }
  }
  return rows;
}

/** @returns {Row|null} */
export function matchSchedule(entry, rows) {
  const name = norm(entry.label);
  const nameSansCode = entry.code ? norm(entry.label.slice(entry.code.length)) : name;
  let best = null;
  for (const r of rows) {
    const t = norm(r.text);
    const byName = nameSansCode.length >= 6 && t.includes(nameSansCode);
    const byCode = entry.code && t.startsWith(entry.code + ' ') && nameSansCode.split(' ')[0]
      && t.includes(nameSansCode.split(' ')[0]);
    if (byName || byCode) {
      if (!best || t.length < norm(best.text).length) best = r;
    }
  }
  return best;
}
