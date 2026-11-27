// Text on the sheet, with positions.
//
// pdf.js hands text back as items: a string, a transform (whose last two
// entries are the baseline start), a width and a height, all in page units.
// Items on one baseline form a row. A row can carry text from several
// columns of the sheet (a legend label, a scale bar, a north arrow), so a row
// is also split into lines wherever the gap between words is wider than a few
// characters. The scale bar and a schedule row need the whole baseline;
// a legend label needs the run of text beside its symbol.
//
// Rotated text (labels along a road) is skipped; nothing here reads it.

function horizontalWords(items) {
  const words = [];
  for (const it of items) {
    if (!it.str || !it.str.trim() || !it.transform) continue;
    const [a, b, , d, e, f] = it.transform;
    if (Math.abs(b) > 1e-3) continue; // rotated
    const h = Math.abs(it.height || d || a) || 1;
    words.push({ str: it.str, x0: e, x1: e + (it.width || 0), y: f, h });
  }
  words.sort((p, q) => q.y - p.y || p.x0 - q.x0);
  return words;
}

function finish(ln) {
  ln.words.sort((p, q) => p.x0 - q.x0);
  let s = '';
  let lastX1 = null;
  for (const w of ln.words) {
    const t = w.str;
    if (s && lastX1 != null && w.x0 - lastX1 > 0.15 * ln.h && !s.endsWith(' ') && !t.startsWith(' ')) s += ' ';
    s += t;
    lastX1 = w.x1;
    ln.h = Math.max(ln.h, w.h);
  }
  ln.str = s.replace(/\s+/g, ' ').trim();
  ln.x0 = ln.words[0].x0;
  ln.x1 = Math.max(...ln.words.map((w) => w.x1));
  return ln;
}

/**
 * Whole baselines.
 * @returns {Row[]} top to bottom. Row: { str, x0, x1, y, h, words: [{str, x0, x1, y, h}] }
 */
export function textRows(items) {
  const rows = [];
  let cur = null;
  for (const w of horizontalWords(items)) {
    if (cur && Math.abs(w.y - cur.y) <= Math.max(1, 0.35 * Math.max(cur.h, w.h))) {
      cur.words.push(w);
    } else {
      cur = { y: w.y, h: w.h, words: [w] };
      rows.push(cur);
    }
  }
  return rows.map(finish).filter((r) => r.str);
}

/**
 * Runs of text: rows split at wide gaps.
 * @returns {Line[]} top to bottom, then left to right; each carries `row`, its row index.
 */
export function textLines(items) {
  const lines = [];
  textRows(items).forEach((row, ri) => {
    let ln = null;
    const gapLimit = Math.max(2.5 * row.h, 14);
    for (const w of row.words) {
      if (ln && w.x0 - ln.lastX1 > gapLimit) ln = null;
      if (!ln) { ln = { y: row.y, h: row.h, words: [], lastX1: w.x1, row: ri }; lines.push(ln); }
      ln.words.push(w);
      ln.lastX1 = Math.max(ln.lastX1, w.x1);
    }
  });
  for (const ln of lines) { delete ln.lastX1; finish(ln); }
  return lines.filter((ln) => ln.str);
}
