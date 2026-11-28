// The plant schedule: the table on the sheet (or another sheet of the set)
// that lists each plant with its quantity. It is the designer's own count,
// so a legend symbol counted on the plan can be checked against it.
//
// Two layouts are read. A table with a QTY column: the quantity is the
// number under that heading, and the name is whatever sits in the name
// column on the same or the next baseline, since names wrap. Without a
// heading, a row that ends in a whole number (or whose number is followed by
// a wide gap) is a schedule row and the words before the number are its
// name. A legend entry matches a row when the row contains the entry's
// name, or starts with the entry's code followed by its name.

function norm(s) {
  return s.toUpperCase().replace(/[’‘'"“”`]/g, '').replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * A quantity can arrive glued to the cell before it as one text item
 * ("… 1.5\" CAL. 3"). Split such an item into the text and the number, with
 * the number placed at the item's right end.
 */
function splitWords(words) {
  const out = [];
  for (const w of words) {
    const m = w.str.match(/^(.*\S)\s+(\d{1,4})\s*$/);
    if (!m || /^\d+$/.test(w.str.trim())) { out.push(w); continue; }
    const frac = m[2].length / w.str.trim().length;
    const cut = w.x1 - (w.x1 - w.x0) * frac;
    out.push({ ...w, str: m[1], x1: cut }, { ...w, str: m[2], x0: cut });
  }
  return out;
}

const QTY_HEAD = /^(?:QTY\.?|QUANTITY|QUAN\.?|NO\.?|COUNT)$/i;
const NAME_HEAD = /BOTANICAL|COMMON|SPECIES|PLANT NAME|SCIENTIFIC|^NAME$/i;
const OTHER_HEAD = /^(?:SIZE|CONTAINER|CONT\.?|REMARKS|NOTES|COMMENTS|DESCRIPTION|SPEC\.?|SPACING|CAL\.?|CALIPER|HEIGHT|HT\.?|SPREAD|ROOT|COND\.?|CONDITION|NATIVE|DIVERSITY)\b/i;

function columnRows(rows) {
  // The heading row: a QTY word and a name word on one baseline.
  let head = null;
  for (const r of rows) {
    if (!r.words) continue;
    const q = r.words.find((w) => QTY_HEAD.test(w.str.trim()));
    const n = r.words.find((w) => NAME_HEAD.test(w.str.trim()));
    if (q && n) { head = { y: r.y, h: r.h, qx: (q.x0 + q.x1) / 2, nx0: n.x0 }; break; }
  }
  if (!head) return [];
  // The name column ends where the next heading to its right starts.
  const headRow = rows.find((r) => r.y === head.y);
  const rightHeads = headRow.words.filter((w) => w.x0 > head.nx0 + 10 && (OTHER_HEAD.test(w.str.trim()) || QTY_HEAD.test(w.str.trim())));
  const nx1 = rightHeads.length ? Math.min(...rightHeads.map((w) => w.x0)) - 2 : head.nx0 + 260;
  const out = [];
  const seen = new Set();
  for (const r of rows) {
    if (r.y >= head.y || !r.words) continue;
    for (const w of r.words) {
      if (!/^\d{1,4}$/.test(w.str.trim()) || Math.abs((w.x0 + w.x1) / 2 - head.qx) > 30) continue;
      // The name cell: words in the name column within a line above or below.
      const cell = [];
      for (const rr of rows) {
        if (!rr.words || Math.abs(rr.y - w.y) > 1.4 * Math.max(rr.h, w.h)) continue;
        for (const x of rr.words) if (x.x0 >= head.nx0 - 6 && x.x0 < nx1 && x !== w) cell.push({ ...x, y: rr.y });
      }
      if (!cell.length) continue;
      cell.sort((a, b) => b.y - a.y || a.x0 - b.x0);
      const text = cell.map((x) => x.str).join(' ').replace(/\s+/g, ' ').trim();
      if (!/[A-Za-z]{3}/.test(text) || seen.has(text)) continue;
      seen.add(text);
      out.push({ text, qty: +w.str.trim() });
    }
  }
  return out;
}

function trailingRows(rows) {
  const out = [];
  for (const ln of rows) {
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
    out.push(found);
  }
  return out;
}

/**
 * @param {{rows: Row[], page: number}[]} pages   whole baselines, from textRows
 * @returns {Row[]}  Row: { text, qty, page, column: boolean }
 */
export function parseSchedule(pages) {
  const rows = [];
  for (const { rows: raw, page } of pages) {
    const lines = raw.map((r) => (r.words ? { ...r, words: splitWords(r.words) } : r));
    for (const r of columnRows(lines)) rows.push({ ...r, page, column: true });
    for (const r of trailingRows(lines)) rows.push({ ...r, page, column: false });
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
    const byName = nameSansCode.length >= 6 && (t.includes(nameSansCode) || nameSansCode.includes(t) && t.length >= 10);
    const byCode = entry.code && t.startsWith(entry.code + ' ') && nameSansCode.split(' ')[0]
      && t.includes(nameSansCode.split(' ')[0]);
    if (byName || byCode) {
      // Prefer a column-read row, then the shortest text (the least noise).
      if (!best || (r.column && !best.column) || (r.column === best.column && t.length < norm(best.text).length)) best = r;
    }
  }
  return best;
}
