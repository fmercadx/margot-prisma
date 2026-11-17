// The click screen. PDF.js draws the sheet; an SVG laid over it, in the same
// coordinates the matcher uses (PDF points from the top-left of the page as
// displayed), takes the clicks and shows the boxes. The counting itself runs
// in worker.js, in Python, with the same modules as the command line.

import * as pdfjsLib from "./pdfjs/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("./pdfjs/pdf.worker.min.mjs", import.meta.url).href;

const $ = (id) => document.getElementById(id);
const rel = (p) => new URL(p, import.meta.url).href;
const SVG = "http://www.w3.org/2000/svg";
// One colour per item for counted copies; orange is kept for "check this".
const COLOURS = ["#009646", "#1e5adc", "#9628aa", "#008c96", "#c8006e", "#785014", "#14286e", "#6e7800"];
const REVIEW = "#eb7800";
const MAX_PIXELS = 36e6, MAX_SIDE = 8000;

const S = {
  doc: null, name: "", geom: [], info: {}, page: 1, zoom: 0, scale: 1,
  items: [], nextColour: 0, hits: [], legend: [], notes: [], counted: [],
  decisions: {}, selected: null, mode: null, stale: false,
};

// ---------------------------------------------------------------- worker ---
const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
const waiting = new Map();
let seq = 1, runtimeReady = false;

worker.onmessage = (e) => {
  const { id, result, error } = e.data;
  if (id === 0) {
    runtimeReady = !error;
    status(error ? "failed" : "ready", error ? "Could not start" : "Ready");
    if (error) $("countMsg").textContent = "The counting tools could not start: " + error;
    refresh();
    return;
  }
  const w = waiting.get(id);
  waiting.delete(id);
  if (error) w.reject(new Error(error)); else w.resolve(result);
};

function call(op, ...args) {
  return new Promise((resolve, reject) => {
    const id = seq++;
    waiting.set(id, { resolve, reject });
    worker.postMessage({ id, op, args });
  });
}

function status(kind, text) {
  $("rt").className = "rt " + kind;
  $("rtText").textContent = text;
}

let busyCount = 0;
function busy(text) {
  busyCount++;
  $("veilText").textContent = text;
  $("veil").classList.remove("hide");
  status("busy", "Working");
}
function idle() {
  busyCount = Math.max(0, busyCount - 1);
  if (!busyCount) {
    $("veil").classList.add("hide");
    status(runtimeReady ? "ready" : "loading", runtimeReady ? "Ready" : "Starting");
  }
}

// ------------------------------------------------------------- open a PDF ---
$("picker").addEventListener("change", (e) => e.target.files[0] && openFile(e.target.files[0]));
const drop = $("drop");
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  const f = e.dataTransfer.files[0];
  if (f) openFile(f);
});

async function openFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  $("intro").classList.add("hide");
  $("ws").classList.remove("hide");
  busy("Opening " + file.name + "…");
  try {
    // PDF.js takes ownership of the buffer it is given, so it gets a copy.
    S.doc = await pdfjsLib.getDocument({
      data: bytes.slice(), cMapUrl: rel("./pdfjs/cmaps/"), cMapPacked: true,
      standardFontDataUrl: rel("./pdfjs/standard_fonts/"), wasmUrl: rel("./pdfjs/wasm/"),
      iccUrl: rel("./pdfjs/iccs/"), isEvalSupported: false, enableXfa: false,
    }).promise;
    if (!runtimeReady) $("veilText").textContent = "Starting the counting tools (first visit only takes a while)…";
    S.geom = JSON.parse(await call("open_pdf", bytes, file.name));
    Object.assign(S, { name: file.name, info: {}, items: [], nextColour: 0, hits: [], legend: [],
                       notes: [], counted: [], decisions: {}, selected: null, stale: false });
    sheetList();
    renderItems();
    renderResults();
    await showPage(1);
  } catch (err) {
    $("countMsg").textContent = "Could not open this file: " + err.message;
    $("countMsg").classList.add("err");
  } finally {
    idle();
  }
}

// ----------------------------------------------------------------- sheets ---
function sheetList() {
  const nav = $("sheets");
  nav.textContent = "";
  for (const g of S.geom) {
    const b = document.createElement("button");
    const info = S.info[g.page];
    b.textContent = info && info.sheet ? info.sheet : "Page " + g.page;
    const tag = document.createElement("small");
    tag.textContent = [info && info.sheet ? "page " + g.page : "", info && info.legend ? "legend" : "",
                       info && info.scanned ? "scanned" : "", sheetCount(g.page)].filter(Boolean).join(" · ");
    b.appendChild(tag);
    if (g.page === S.page) b.className = "cur";
    b.addEventListener("click", () => showPage(g.page));
    nav.appendChild(b);
  }
}

function sheetCount(page) {
  if (!S.counted.includes(page)) return "";
  const n = S.hits.filter((h) => h.page === page && isCounted(h)).length;
  return n + " counted";
}

async function showPage(n) {
  S.page = n;
  S.zoom = 0;
  sheetList();
  await render();
  $("scroller").scrollTo(0, 0);
}

// ----------------------------------------------------------------- render ---
let renderTask = null;

async function render(keepCentre) {
  if (!S.doc) return;
  const scroller = $("scroller");
  const centre = keepCentre && {
    x: (scroller.scrollLeft + scroller.clientWidth / 2) / scroller.scrollWidth,
    y: (scroller.scrollTop + scroller.clientHeight / 2) / scroller.scrollHeight,
  };
  const page = await S.doc.getPage(S.page);
  const base = page.getViewport({ scale: 1 });
  const fit = Math.max(0.05, (scroller.clientWidth - 8) / base.width);
  let scale = S.zoom || fit;
  scale = Math.min(scale, MAX_SIDE / Math.max(base.width, base.height), Math.sqrt(MAX_PIXELS / (base.width * base.height)));
  S.scale = scale;
  const vp = page.getViewport({ scale });
  const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(MAX_PIXELS / (vp.width * vp.height)));
  const canvas = $("canvas");
  canvas.width = Math.floor(vp.width * ratio);
  canvas.height = Math.floor(vp.height * ratio);
  canvas.style.width = vp.width + "px";
  canvas.style.height = vp.height + "px";
  $("stage").style.width = vp.width + "px";
  $("stage").style.height = vp.height + "px";
  const g = S.geom[S.page - 1];
  const [x0, top, x1, bottom] = g.crop;
  $("overlay").setAttribute("viewBox", `${x0} ${top} ${x1 - x0} ${bottom - top}`);
  drawOverlay();
  if (renderTask) renderTask.cancel();
  renderTask = page.render({ canvas, canvasContext: canvas.getContext("2d"), viewport: vp,
                             transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null });
  try { await renderTask.promise; } catch (e) { if (e.name !== "RenderingCancelledException") throw e; }
  if (centre) {
    scroller.scrollLeft = centre.x * scroller.scrollWidth - scroller.clientWidth / 2;
    scroller.scrollTop = centre.y * scroller.scrollHeight - scroller.clientHeight / 2;
  }
}

$("zoomIn").addEventListener("click", () => { S.zoom = S.scale * 1.6; render(true); });
$("zoomOut").addEventListener("click", () => { S.zoom = Math.max(0.05, S.scale / 1.6); render(true); });
$("zoomFit").addEventListener("click", () => { S.zoom = 0; render(); });
let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (!S.zoom) render(); }, 150);
});

function el(name, attrs) {
  const e = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

function colourOf(name) {
  const it = S.items.find((i) => i.name === name);
  return it ? it.colour : "#555";
}

function isCounted(h) {
  const d = S.decisions[h.id];
  if (d === "drop") return false;
  if (S.legend.includes(h.page)) return false;
  return h.status === "match" || d === "count";
}

function drawOverlay() {
  const svg = $("overlay");
  svg.textContent = "";
  for (const it of S.items) {
    if (it.page !== S.page) continue;
    const [x0, t, x1, b] = it.box;
    svg.appendChild(el("rect", { x: x0, y: t, width: x1 - x0, height: b - t, fill: "none", stroke: it.colour,
      "stroke-width": 2, "stroke-dasharray": "4 3", "vector-effect": "non-scaling-stroke" }));
  }
  for (const h of S.hits) {
    if (h.page !== S.page) continue;
    const d = S.decisions[h.id];
    const counted = isCounted(h);
    const colour = d === "drop" ? "#888" : counted ? colourOf(h.item) : REVIEW;
    const r = el("rect", { x: h.x - h.hw - 1, y: h.y - h.hh - 1, width: 2 * h.hw + 2, height: 2 * h.hh + 2,
      fill: "transparent", stroke: colour, "stroke-width": h.id === S.selected ? 4 : 2,
      "vector-effect": "non-scaling-stroke", "data-id": h.id, style: "cursor:pointer" });
    if (d === "drop") r.setAttribute("stroke-dasharray", "3 3");
    svg.appendChild(r);
  }
}

// ------------------------------------------------------- clicks and boxes ---
const overlay = $("overlay");

function toPdf(evt) {
  const pt = overlay.createSVGPoint();
  pt.x = evt.clientX;
  pt.y = evt.clientY;
  return pt.matrixTransform(overlay.getScreenCTM().inverse());
}

function setMode(mode) {
  S.mode = mode;
  $("pick").classList.toggle("on", mode === "pick");
  $("boxPick").classList.toggle("on", mode === "box");
  $("stage").classList.toggle("picking", !!mode);
  const hint = $("hint");
  hint.classList.toggle("act", !!mode);
  hint.textContent = mode === "pick" ? "Click on a line of one symbol. Esc to cancel."
    : mode === "box" ? "Drag a box around one whole symbol. Esc to cancel."
    : "Drag to scroll. Zoom in to click small symbols.";
}

$("pick").addEventListener("click", () => setMode(S.mode === "pick" ? null : "pick"));
$("boxPick").addEventListener("click", () => setMode(S.mode === "box" ? null : "box"));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") setMode(null); });

let drag = null;
overlay.addEventListener("pointerdown", (e) => {
  if (S.mode === "box") {
    const p = toPdf(e);
    drag = { kind: "box", x: p.x, y: p.y, rect: el("rect", { fill: "none", stroke: "#1f4d3d", "stroke-width": 2,
      "stroke-dasharray": "4 3", "vector-effect": "non-scaling-stroke" }) };
    overlay.appendChild(drag.rect);
    overlay.setPointerCapture(e.pointerId);
  } else if (!S.mode) {
    const id = e.target.getAttribute && e.target.getAttribute("data-id");
    if (id !== null && id !== undefined && id !== "") { select(Number(id)); return; }
    const sc = $("scroller");
    drag = { kind: "pan", cx: e.clientX, cy: e.clientY, sl: sc.scrollLeft, st: sc.scrollTop };
    overlay.setPointerCapture(e.pointerId);
  }
});
overlay.addEventListener("pointermove", (e) => {
  if (!drag) return;
  if (drag.kind === "pan") {
    const sc = $("scroller");
    sc.scrollLeft = drag.sl - (e.clientX - drag.cx);
    sc.scrollTop = drag.st - (e.clientY - drag.cy);
  } else {
    const p = toPdf(e);
    drag.rect.setAttribute("x", Math.min(p.x, drag.x));
    drag.rect.setAttribute("y", Math.min(p.y, drag.y));
    drag.rect.setAttribute("width", Math.abs(p.x - drag.x));
    drag.rect.setAttribute("height", Math.abs(p.y - drag.y));
  }
});
overlay.addEventListener("pointerup", (e) => {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (d.kind === "box") {
    const p = toPdf(e);
    d.rect.remove();
    const box = [Math.min(p.x, d.x), Math.min(p.y, d.y), Math.max(p.x, d.x), Math.max(p.y, d.y)];
    if (box[2] - box[0] > 1 && box[3] - box[1] > 1) addItem(null, box);
  }
});
overlay.addEventListener("click", (e) => {
  if (S.mode === "pick") addItem(toPdf(e), null);
});

// ------------------------------------------------------------------ items ---
async function ensureLoaded(page, text) {
  if (S.info[page]) return S.info[page];
  busy(text || "Reading this sheet… a large sheet can take a minute.");
  try {
    S.info[page] = JSON.parse(await call("load", page));
  } finally {
    idle();
  }
  sheetList();
  return S.info[page];
}

async function addItem(point, box) {
  const msg = $("itemMsg");
  msg.classList.remove("err");
  const name = $("itemName").value.trim() || `Item ${S.items.length + 1}`;
  if (S.items.some((i) => i.name === name)) {
    msg.textContent = `There is already an item called “${name}”. Give this one another name.`;
    msg.classList.add("err");
    return;
  }
  setMode(null);
  try {
    const info = await ensureLoaded(S.page);
    if (info.scanned) {
      msg.textContent = "This sheet has no lines to compare. It looks scanned; this tool needs PDFs exported from CAD.";
      msg.classList.add("err");
      return;
    }
    busy("Taking the example…");
    let r;
    try {
      r = JSON.parse(await call("seed", name, S.page, point ? point.x : 0, point ? point.y : 0,
                                box ? JSON.stringify(box) : ""));
    } finally {
      idle();
    }
    if (r.error) {
      msg.textContent = (point ? "Couldn't take a symbol there: " : "Couldn't use that box: ") + r.error +
        (point ? " Try clicking right on one of its lines, zooming in first." : "");
      msg.classList.add("err");
      return;
    }
    S.items.push({ name, page: S.page, box: r.box, colour: COLOURS[S.nextColour++ % COLOURS.length] });
    $("itemName").value = "";
    msg.textContent = `Added “${name}”. The dashed box shows what was taken as the example; if it looks wrong, remove it and drag a box instead.`;
    if (S.hits.length) S.stale = true;
    renderItems();
    renderResults();
    drawOverlay();
  } catch (err) {
    msg.textContent = "Something went wrong: " + err.message;
    msg.classList.add("err");
  }
}

function renderItems() {
  const ul = $("items");
  ul.textContent = "";
  for (const it of S.items) {
    const li = document.createElement("li");
    const sw = document.createElement("span");
    sw.className = "sw";
    sw.style.background = it.colour;
    const nm = document.createElement("span");
    nm.className = "nm";
    nm.textContent = it.name + " ";
    const where = document.createElement("small");
    where.textContent = (S.info[it.page] && S.info[it.page].sheet) || "page " + it.page;
    nm.appendChild(where);
    const show = document.createElement("button");
    show.className = "btn small";
    show.textContent = "Show";
    show.addEventListener("click", () => goTo(it.page, (it.box[0] + it.box[2]) / 2, (it.box[1] + it.box[3]) / 2));
    const rm = document.createElement("button");
    rm.className = "btn small";
    rm.textContent = "Remove";
    rm.setAttribute("aria-label", "Remove " + it.name);
    rm.addEventListener("click", async () => {
      S.items = S.items.filter((i) => i !== it);
      await call("forget", it.name);
      if (S.hits.length) S.stale = true;
      renderItems();
      renderResults();
      drawOverlay();
    });
    li.append(sw, nm, show, rm);
    ul.appendChild(li);
  }
  refresh();
}

function refresh() {
  $("count").disabled = !(runtimeReady && S.doc && S.items.length);
}

// ------------------------------------------------------------------ count ---
$("count").addEventListener("click", runCount);

async function runCount() {
  const msg = $("countMsg");
  msg.classList.remove("err");
  msg.textContent = "";
  const pages = $("scope").value === "all" ? S.geom.map((g) => g.page) : [S.page];
  try {
    for (const [k, n] of pages.entries()) {
      await ensureLoaded(n, pages.length > 1 ? `Reading sheet ${k + 1} of ${pages.length}…` : undefined);
    }
    busy("Counting…");
    let r;
    try {
      r = JSON.parse(await call("count", JSON.stringify(pages)));
    } finally {
      idle();
    }
    Object.assign(S, { hits: r.hits, legend: r.legend, notes: r.notes, counted: pages, decisions: {},
                       selected: null, stale: false });
    const scanned = pages.filter((n) => S.info[n] && S.info[n].scanned).length;
    if (scanned) msg.textContent = `${scanned} sheet(s) look scanned and couldn't be counted.`;
    sheetList();
    renderResults();
    drawOverlay();
  } catch (err) {
    msg.textContent = "Counting failed: " + err.message;
    msg.classList.add("err");
  }
}

function renderResults() {
  const box = $("results");
  box.classList.toggle("hide", !S.counted.length);
  if (!S.counted.length) return;
  const t = $("resTable");
  t.textContent = "";
  const head = t.insertRow();
  for (const [txt, n] of [["Item", 0], ["Counted", 1], ["To check", 1]]) {
    const th = document.createElement("th");
    th.textContent = txt;
    if (n) th.className = "n";
    head.appendChild(th);
  }
  for (const it of S.items) {
    const mine = S.hits.filter((h) => h.item === it.name && !S.legend.includes(h.page));
    const counted = mine.filter(isCounted);
    const toCheck = mine.filter((h) => h.status === "review" && !S.decisions[h.id]);
    const row = t.insertRow();
    const c0 = row.insertCell();
    const sw = document.createElement("span");
    sw.className = "sw";
    sw.style.cssText = `display:inline-block;margin-right:.4rem;background:${it.colour}`;
    c0.append(sw, document.createTextNode(it.name));
    const c1 = row.insertCell(); c1.className = "n"; c1.textContent = counted.length;
    const c2 = row.insertCell(); c2.className = "n"; c2.textContent = toCheck.length;
    // The same graphic with a different label is often a different device.
    const labels = {};
    for (const h of counted) labels[h.text || ""] = (labels[h.text || ""] || 0) + 1;
    const keys = Object.keys(labels);
    if (keys.length > 1 || (keys.length === 1 && keys[0])) {
      for (const k of keys.sort((a, b) => labels[b] - labels[a])) {
        const sub = t.insertRow();
        sub.className = "sub";
        sub.insertCell().textContent = k ? `  labelled ${k}` : "  no label";
        const n = sub.insertCell(); n.className = "n"; n.textContent = labels[k];
        sub.insertCell();
      }
    }
  }
  const notes = [...S.notes];
  if (S.legend.length) notes.push("Legend sheets are marked but not counted.");
  if (S.stale) notes.unshift("The items changed since this count. Press Count again.");
  $("notes").textContent = notes.join(" ");
  $("notes").classList.toggle("hide", !notes.length);
  renderDetail();
}

// ------------------------------------------------------ check, count, drop ---
function select(id) {
  S.selected = id;
  drawOverlay();
  renderDetail();
}

function renderDetail() {
  const d = $("detail");
  const h = S.hits.find((x) => x.id === S.selected);
  d.classList.toggle("hide", !h);
  if (!h) return;
  d.textContent = "";
  const title = document.createElement("strong");
  const decision = S.decisions[h.id];
  title.textContent = `${h.item} — ${decision === "drop" ? "dropped by you" : decision === "count" ? "counted by you"
    : h.status === "match" ? "counted" : "needs your eye"}`;
  d.appendChild(title);
  const dl = document.createElement("dl");
  const rows = [
    ["Sheet", (h.sheet || "page " + h.page) + (S.legend.includes(h.page) ? " (legend, not counted)" : "")],
    ["Label beside it", h.text || "—"],
    ["Circuit", h.label || "—"],
    ["Turned", h.orient + "°"],
    ["Fit", `${Math.round(h.coverage * 100)}% of the example found, ${Math.round(h.purity * 100)}% of its ink explained, ${h.extra} pt extra`],
  ];
  if (h.also) rows.push(["Also looks like", h.also]);
  if (h.note) rows.push(["Note", h.note]);
  for (const [k, v] of rows) {
    const dt = document.createElement("dt"); dt.textContent = k;
    const dd = document.createElement("dd"); dd.textContent = v;
    dl.append(dt, dd);
  }
  d.appendChild(dl);
  const row = document.createElement("div");
  row.className = "row";
  const mk = (txt, fn) => { const b = document.createElement("button"); b.className = "btn small"; b.textContent = txt; b.addEventListener("click", fn); row.appendChild(b); };
  if (h.status !== "match" && decision !== "count") mk("Count it", () => decide(h.id, "count"));
  if (decision !== "drop") mk("Don't count", () => decide(h.id, "drop"));
  if (decision) mk("Undo", () => decide(h.id, null));
  d.appendChild(row);
}

function decide(id, what) {
  if (what) S.decisions[id] = what; else delete S.decisions[id];
  drawOverlay();
  renderResults();
  sheetList();
}

$("nextReview").addEventListener("click", () => {
  const todo = S.hits.filter((h) => h.status === "review" && !S.decisions[h.id] && !S.legend.includes(h.page))
    .sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
  if (!todo.length) { $("countMsg").textContent = "Nothing left to check."; return; }
  const cur = S.hits.find((h) => h.id === S.selected);
  const after = cur ? todo.find((h) => h.page > cur.page || (h.page === cur.page && (h.y > cur.y || (h.y === cur.y && h.x > cur.x)))) : null;
  const h = after || todo[0];
  goTo(h.page, h.x, h.y).then(() => select(h.id));
});

async function goTo(page, x, y) {
  if (page !== S.page) { S.page = page; sheetList(); }
  if (!S.zoom || S.scale < 1.2) S.zoom = Math.max(S.scale, 1.5);
  await render();
  const g = S.geom[page - 1];
  const sc = $("scroller");
  sc.scrollLeft = (x - g.crop[0]) * S.scale - sc.clientWidth / 2;
  sc.scrollTop = (y - g.crop[1]) * S.scale - sc.clientHeight / 2;
}

// --------------------------------------------------------------- download ---
$("download").addEventListener("click", async () => {
  busy("Writing the spreadsheet…");
  try {
    const bytes = await call("xlsx", JSON.stringify(S.decisions));
    const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (S.name.replace(/\.pdf$/i, "") || "drawing") + "-takeoff.xlsx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  } catch (err) {
    $("countMsg").textContent = "Couldn't write the spreadsheet: " + err.message;
    $("countMsg").classList.add("err");
  } finally {
    idle();
  }
});

// For the browser smoke test: where a PDF point is on screen right now.
window.__takeoff = {
  state: S,
  pdfToClient(x, y) {
    const pt = overlay.createSVGPoint();
    pt.x = x;
    pt.y = y;
    const p = pt.matrixTransform(overlay.getScreenCTM());
    return { x: p.x, y: p.y };
  },
  goTo,
};
