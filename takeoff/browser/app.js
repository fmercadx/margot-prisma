// The click screen. PDF.js draws the sheet; an SVG laid over it, in the same
// coordinates the matcher uses (PDF points from the top-left of the page as
// displayed), takes the clicks and shows the boxes, circuit runs and measured
// lengths. The counting and measuring run in worker.js, in Python, with the
// same modules as the command line.

import * as pdfjsLib from "./pdfjs/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("./pdfjs/pdf.worker.min.mjs", import.meta.url).href;

const $ = (id) => document.getElementById(id);
const rel = (p) => new URL(p, import.meta.url).href;
const SVG = "http://www.w3.org/2000/svg";
// One colour per item for counted copies; orange is kept for "check this".
const COLOURS = ["#009646", "#1e5adc", "#9628aa", "#008c96", "#c8006e", "#785014", "#14286e", "#6e7800"];
const REVIEW = "#eb7800";
const CIRCUIT = "#00828c", RUN = "#be0096";
const MAX_PIXELS = 36e6, MAX_SIDE = 8000;

const S = {
  doc: null, name: "", geom: [], info: {}, page: 1, zoom: 0, scale: 1,
  items: [], nextColour: 0, hits: [], legend: [], notes: [], counted: [],
  decisions: {}, selected: null, mode: null, stale: false,
  scales: {}, runs: [], circuits: [], circNotes: [], circStale: false, selCircuit: null,
  trace: [], scalePts: [], panelFor: null,
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
                       notes: [], counted: [], decisions: {}, selected: null, stale: false,
                       scales: {}, runs: [], circuits: [], circNotes: [], circStale: false, selCircuit: null,
                       trace: [], scalePts: [], panelFor: null });
    sheetList();
    renderItems();
    renderResults();
    renderCircuits();
    renderRuns();
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
  S.trace = [];
  S.scalePts = [];
  sheetList();
  await render();
  $("scroller").scrollTo(0, 0);
  if (S.info[n]) await readScale(n); else scaleLine();
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
  drawLengths(svg);
}

function segPath(segs) {
  return segs.map((s) => `M${s[0]} ${s[1]}L${s[2]} ${s[3]}`).join("");
}

function drawLengths(svg) {
  if ($("showCirc").checked) {
    for (const c of S.circuits) {
      if (c.page !== S.page) continue;
      const sel = c.id === S.selCircuit;
      const w = sel ? 4 : 2;
      if (c.route.length) svg.appendChild(el("path", { d: segPath(c.route), fill: "none", stroke: CIRCUIT,
        "stroke-width": w, "stroke-opacity": sel ? 1 : 0.75, "vector-effect": "non-scaling-stroke",
        "pointer-events": "none" }));
      if (c.homerun.length) svg.appendChild(el("path", { d: segPath(c.homerun), fill: "none", stroke: CIRCUIT,
        "stroke-width": w, "stroke-dasharray": "6 4", "vector-effect": "non-scaling-stroke", "pointer-events": "none" }));
    }
  }
  for (const r of S.runs) {
    if (r.page !== S.page) continue;
    svg.appendChild(el("path", { d: segPath(r.segs), fill: "none", stroke: RUN, "stroke-width": 3,
      "vector-effect": "non-scaling-stroke", "pointer-events": "none" }));
  }
  const live = S.mode === "trace" ? S.trace : S.mode === "scalePts" || S.scalePts.length === 2 ? S.scalePts : [];
  if (live.length) {
    const d = live.map((p, k) => (k ? "L" : "M") + p.x + " " + p.y).join("");
    svg.appendChild(el("path", { id: "livePath", d, fill: "none", stroke: RUN, "stroke-width": 2,
      "stroke-dasharray": "5 3", "vector-effect": "non-scaling-stroke", "pointer-events": "none" }));
    for (const p of live) svg.appendChild(el("circle", { cx: p.x, cy: p.y, r: 2.5 / S.scale + 0.8, fill: RUN,
      "pointer-events": "none" }));
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

const HINTS = {
  pick: "Click on a line of one symbol. Esc to cancel.",
  box: "Drag a box around one whole symbol. Esc to cancel.",
  trace: "Click along the route. Double-click, Enter or Finish to end; Esc to cancel.",
  follow: "Click on the line to measure. Esc to cancel.",
  scalePts: "Click two points a known distance apart, e.g. the ends of a dimension.",
  panel: "Click where the panel is. Esc to cancel.",
  wire: "Click on one drawn wire. Esc to cancel.",
};

function setMode(mode) {
  if (S.mode === "trace" && mode !== "trace") S.trace = [];
  if (mode === "scalePts") S.scalePts = [];
  S.mode = mode;
  $("pick").classList.toggle("on", mode === "pick");
  $("boxPick").classList.toggle("on", mode === "box");
  $("trace").classList.toggle("on", mode === "trace");
  $("follow").classList.toggle("on", mode === "follow");
  $("scalePts").classList.toggle("on", mode === "scalePts");
  $("wirePick").classList.toggle("on", mode === "wire");
  $("traceDone").classList.toggle("hide", mode !== "trace");
  $("stage").classList.toggle("picking", !!mode);
  const hint = $("hint");
  hint.classList.toggle("act", !!mode);
  hint.textContent = mode === "panel" ? `Click where panel ${S.panelFor} is. Esc to cancel.`
    : HINTS[mode] || "Drag to scroll. Zoom in to click small symbols.";
  drawOverlay();
}

$("pick").addEventListener("click", () => setMode(S.mode === "pick" ? null : "pick"));
$("boxPick").addEventListener("click", () => setMode(S.mode === "box" ? null : "box"));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") setMode(null);
  if (e.key === "Enter" && S.mode === "trace" && document.activeElement.tagName !== "INPUT") finishTrace();
});

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
  if (!drag && S.mode === "trace" && S.trace.length) {
    // The leg from the last point to the pointer, as a preview.
    const p = toPdf(e);
    const live = document.getElementById("livePath");
    if (live) live.setAttribute("d", S.trace.map((q, k) => (k ? "L" : "M") + q.x + " " + q.y).join("") + `L${p.x} ${p.y}`);
  }
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
  const p = toPdf(e);
  if (S.mode === "pick") addItem(p, null);
  else if (S.mode === "trace") { S.trace.push({ x: p.x, y: p.y }); drawOverlay(); }
  else if (S.mode === "follow") measureRun("follow", [[p.x, p.y], [Math.max(1.5, 6 / S.scale), 0]]);
  else if (S.mode === "scalePts") {
    S.scalePts.push({ x: p.x, y: p.y });
    if (S.scalePts.length === 2) {
      setMode(null);
      S.scalePts = S.scalePts.slice(0, 2);
      $("scaleFeetRow").classList.remove("hide");
      $("scaleFeet").focus();
    }
    drawOverlay();
  } else if (S.mode === "panel") placePanel(p);
  else if (S.mode === "wire") pickWire(p);
});
overlay.addEventListener("dblclick", (e) => {
  if (S.mode !== "trace") return;
  e.preventDefault();
  // The double-click's own two clicks added the same point twice.
  const n = S.trace.length;
  if (n >= 2 && Math.hypot(S.trace[n - 1].x - S.trace[n - 2].x, S.trace[n - 1].y - S.trace[n - 2].y) < 2 / S.scale) S.trace.pop();
  finishTrace();
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
    await readScale(S.page);
    await computeCircuits();
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
  if (S.circuits.length || S.circNotes.length) S.circStale = true;
  drawOverlay();
  renderResults();
  renderCircuits();
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
    const bytes = await call("xlsx", JSON.stringify(S.decisions), JSON.stringify(allowances()));
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

// --------------------------------------------------------------- lengths ---
function fmtFeet(f) {
  if (f === null || f === undefined || !isFinite(f)) return "—";
  let whole = Math.floor(f), inches = Math.round((f - whole) * 12);
  if (inches === 12) { whole += 1; inches = 0; }
  return `${whole.toLocaleString()}'-${inches}"`;
}
const fmtFt = (f) => Math.round(f).toLocaleString() + " ft";

async function readScale(page) {
  try {
    S.scales[page] = JSON.parse(await call("scale_info", page));
  } catch (err) { /* the sheet couldn't be read; scaleLine says so */ }
  scaleLine();
}

function scaleLine() {
  const line = $("scaleLine");
  const s = S.scales[S.page];
  if (!S.info[S.page] || !s) {
    line.textContent = "The scale is read from this sheet when you first measure or count on it.";
    return;
  }
  if (s.set) line.textContent = `Scale: ${s.set.text} (set by you). Every length on this sheet uses it.`;
  else if (s.distinct.length === 1) line.textContent = `Scale: ${s.distinct[0]}, as printed on this sheet.`;
  else if (s.distinct.length > 1) line.textContent = `This sheet has drawings at ${s.distinct.join(" and ")}. ` +
    "Each length uses the scale printed under its own drawing; set one here to use it everywhere on this sheet.";
  else line.textContent = "No scale is printed on this sheet. Set one before measuring.";
}

$("scaleChange").addEventListener("click", () => {
  const edit = $("scaleEdit");
  edit.classList.toggle("hide");
  $("scaleChange").setAttribute("aria-expanded", String(!edit.classList.contains("hide")));
});

async function setScale(how, value) {
  const msg = $("runMsg");
  msg.classList.remove("err");
  await ensureLoaded(S.page);
  const r = JSON.parse(await call("set_scale", S.page, how, value));
  if (r.error) { msg.textContent = r.error; msg.classList.add("err"); return; }
  S.runs = r.runs;
  await readScale(S.page);
  msg.textContent = how === "clear" ? "Using the scale printed on the sheet." : `Scale set to ${r.set.text}.`;
  $("scaleFeetRow").classList.add("hide");
  S.scalePts = [];
  renderRuns();
  if (S.hits.length) await computeCircuits();
  drawOverlay();
}
$("scaleSet").addEventListener("click", () => setScale("text", $("scaleText").value));
$("scaleClear").addEventListener("click", () => setScale("clear", ""));
$("scalePts").addEventListener("click", async () => { await ensureLoaded(S.page); setMode(S.mode === "scalePts" ? null : "scalePts"); });
$("scaleFeetSet").addEventListener("click", () => {
  const [a, b] = S.scalePts;
  if (!a || !b) return;
  setScale("points", JSON.stringify([Math.hypot(b.x - a.x, b.y - a.y), Number($("scaleFeet").value)]));
});

$("trace").addEventListener("click", async () => { await ensureLoaded(S.page); setMode(S.mode === "trace" ? null : "trace"); });
$("follow").addEventListener("click", async () => { await ensureLoaded(S.page); setMode(S.mode === "follow" ? null : "follow"); });
$("traceDone").addEventListener("click", finishTrace);

function finishTrace() {
  const pts = S.trace.map((p) => [p.x, p.y]);
  setMode(null);
  if (pts.length < 2) { $("runMsg").textContent = "A traced run needs at least two points."; return; }
  measureRun("trace", pts);
}

async function measureRun(how, pts) {
  const msg = $("runMsg");
  msg.classList.remove("err");
  if (how === "follow") setMode(null);
  const name = $("runName").value.trim() || `Run ${S.runs.length + 1}`;
  busy(how === "follow" ? "Following the line…" : "Measuring…");
  let r;
  try {
    r = JSON.parse(await call("measure_run", how, S.page, JSON.stringify(pts), name));
  } finally {
    idle();
  }
  if (r.error) {
    msg.textContent = (how === "follow" ? "Couldn't follow a line there: " : "Couldn't measure that: ") + r.error +
      (how === "follow" ? " Zoom in and click right on the line." : "");
    msg.classList.add("err");
    return;
  }
  S.runs.push(r);
  $("runName").value = "";
  msg.textContent = r.feet === null ? `${r.name}: no scale on this sheet. Set one and it will be measured.`
    : `${r.name}: ${fmtFeet(r.feet)} at ${r.scale.text}.` + (r.note ? " " + r.note : "");
  if (!readScaleDone(S.page)) await readScale(S.page);
  renderRuns();
  drawOverlay();
}
const readScaleDone = (page) => !!S.scales[page];

function renderRuns() {
  const ul = $("runs");
  ul.textContent = "";
  for (const r of S.runs) {
    const li = document.createElement("li");
    const sw = document.createElement("span");
    sw.className = "sw";
    sw.style.background = RUN;
    const nm = document.createElement("span");
    nm.className = "nm";
    nm.textContent = r.name + " ";
    const meta = document.createElement("small");
    meta.textContent = `${r.sheet || "page " + r.page} · ${r.how}`;
    nm.appendChild(meta);
    const ft = document.createElement("span");
    ft.className = "feet";
    ft.textContent = fmtFeet(r.feet);
    const cond = document.createElement("input");
    cond.type = "number"; cond.min = "1"; cond.className = "cond"; cond.value = r.conductors;
    cond.title = "Wires in this run"; cond.setAttribute("aria-label", "Wires in " + r.name);
    cond.addEventListener("change", async () => {
      S.runs = JSON.parse(await call("edit_run", r.id, JSON.stringify({ conductors: Number(cond.value) || 1 })));
    });
    const show = document.createElement("button");
    show.className = "btn small"; show.textContent = "Show";
    show.addEventListener("click", () => goTo(r.page, r.segs[0][0], r.segs[0][1]));
    const rm = document.createElement("button");
    rm.className = "btn small"; rm.textContent = "Remove"; rm.setAttribute("aria-label", "Remove " + r.name);
    rm.addEventListener("click", async () => {
      S.runs = JSON.parse(await call("forget_run", r.id));
      renderRuns();
      drawOverlay();
    });
    li.append(sw, nm, ft, cond, show, rm);
    ul.appendChild(li);
  }
  $("dlBox").classList.toggle("hide", !(S.counted.length || S.runs.length));
}

function allowances() {
  const num = (id, d) => { const v = Number($(id).value); return isFinite(v) && $(id).value !== "" ? v : d; };
  return { conduit_height: num("aHeight", 10), device_height: num("aDevice", 1.5),
           makeup: num("aMakeup", 1), waste: num("aWaste", 10) / 100 };
}

function circuitFeet(c, a) {
  const drops = c.heights.reduce((s, h) => s + Math.max(0, a.conduit_height - (h === null ? a.device_height : h)), 0);
  const run = c.route_ft + (c.homerun_ft || 0) + drops;
  return { drops, conduit: run * (1 + a.waste),
           wire: (run * c.conductors + a.makeup * c.conductors * c.devices.length) * (1 + a.waste) };
}

async function computeCircuits() {
  if (!S.hits.length) { S.circuits = []; S.circNotes = []; renderCircuits(); return; }
  busy("Measuring circuits…");
  try {
    const r = JSON.parse(await call("circuits", JSON.stringify(S.decisions)));
    S.circuits = r.circuits;
    S.circNotes = r.notes;
    S.circStale = false;
    S.selCircuit = null;
  } catch (err) {
    S.circuits = [];
    S.circNotes = ["Circuits could not be measured: " + err.message];
  } finally {
    idle();
  }
  renderCircuits();
  drawOverlay();
}

function renderCircuits() {
  const box = $("circuitsBox");
  box.classList.toggle("hide", !S.counted.length);
  renderRuns();
  if (!S.counted.length) return;
  const a = allowances();
  let conduit = 0, wire = 0;
  for (const c of S.circuits) { const f = circuitFeet(c, a); conduit += f.conduit; wire += f.wire; }
  $("circSummary").textContent = S.circuits.length
    ? `${S.circuits.length} circuit${S.circuits.length > 1 ? "s" : ""}: about ${fmtFt(conduit)} of conduit and ${fmtFt(wire)} of wire.`
    : "No circuits: the counted devices carry no circuit label and no drawn wiring was found.";
  const notes = [...S.circNotes];
  if (S.circStale) notes.unshift("Your calls changed which devices count. Press Update circuits.");
  const nb = $("circNotes");
  nb.textContent = "";
  for (const n of notes) { const p = document.createElement("p"); p.textContent = n; nb.appendChild(p); }
  nb.classList.toggle("hide", !notes.length);
  $("circUpdate").classList.toggle("hide", !S.circStale);

  // Panels a homerun needs but the drawing doesn't name.
  const pl = $("panelList");
  pl.textContent = "";
  const missing = [...new Set(S.circuits.filter((c) => c.page === S.page && c.panel && c.homerun_ft === null)
    .map((c) => c.panel))];
  if (missing.length) {
    const p = document.createElement("p");
    p.className = "msg";
    p.textContent = "Homeruns need the panel's place on this drawing: ";
    for (const name of missing) {
      const b = document.createElement("button");
      b.className = "btn small";
      b.textContent = "Place " + name;
      b.addEventListener("click", () => { S.panelFor = name; setMode("panel"); });
      p.append(b, document.createTextNode(" "));
    }
    pl.appendChild(p);
  }

  const t = $("circTable");
  t.textContent = "";
  const mine = S.circuits.filter((c) => c.page === S.page);
  if (!mine.length) return;
  const head = t.insertRow();
  for (const [txt, n] of [["Circuit", 0], ["Devices", 1], ["Conduit", 1], ["Wire", 1]]) {
    const th = document.createElement("th"); th.textContent = txt; if (n) th.className = "n"; head.appendChild(th);
  }
  for (const c of mine) {
    const f = circuitFeet(c, a);
    const row = t.insertRow();
    row.className = "pick" + (c.id === S.selCircuit ? " sel" : "");
    row.title = [c.items, `${fmtFeet(c.route_ft)} device to device`, c.homerun_ft === null ? "homerun not measured"
      : `${fmtFeet(c.homerun_ft)} homerun`, `${fmtFeet(f.drops)} of drops`, `${c.conductors} wires`, c.note]
      .filter(Boolean).join("\n");
    row.insertCell().textContent = (c.label || "unnamed") + (c.homerun_ft === null ? " *" : "");
    const d = row.insertCell(); d.className = "n"; d.textContent = c.devices.length;
    const k = row.insertCell(); k.className = "n feet"; k.textContent = fmtFt(f.conduit);
    const w = row.insertCell(); w.className = "n feet"; w.textContent = fmtFt(f.wire);
    row.addEventListener("click", () => {
      S.selCircuit = c.id;
      renderCircuits();
      const h = S.hits[c.devices[0]];
      goTo(c.page, h.x, h.y);
    });
  }
  if (mine.some((c) => c.homerun_ft === null)) {
    const r = t.insertRow(); r.className = "sub";
    const cell = r.insertCell(); cell.colSpan = 4;
    cell.textContent = "* homerun not measured: its panel isn't on this drawing. Place it, or add it in the spreadsheet.";
  }
}

for (const id of ["aHeight", "aDevice", "aMakeup", "aWaste"]) $(id).addEventListener("input", renderCircuits);
$("showCirc").addEventListener("change", drawOverlay);
$("circUpdate").addEventListener("click", computeCircuits);
$("wirePick").addEventListener("click", () => setMode(S.mode === "wire" ? null : "wire"));
$("useLabels").addEventListener("click", async () => {
  await call("set_wires", S.page, 0, 0, true);
  await computeCircuits();
});

async function placePanel(p) {
  const name = S.panelFor;
  setMode(null);
  await call("set_panel", S.page, name, p.x, p.y);
  $("runMsg").textContent = `Panel ${name} placed. Homeruns to it are measured from the nearest device.`;
  await computeCircuits();
}

async function pickWire(p) {
  setMode(null);
  const r = JSON.parse(await call("set_wires", S.page, p.x, p.y, false));
  if (r.error) { $("circSummary").textContent = r.error; return; }
  await computeCircuits();
}

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
