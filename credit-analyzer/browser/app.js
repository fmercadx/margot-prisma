/* Drives the Pyodide runtime and the page around it.
 *
 * Everything is served from this origin — the Pyodide runtime, the Python
 * standard library, pypdf, and the analyzer modules. There is deliberately not
 * a single request to a third party: a page that reads consumer credit files
 * should not be phoning a CDN that then learns who visits it and when.
 */

const $ = (id) => document.getElementById(id);

const rt = $('rt'), rtText = $('rtText');
const drop = $('drop'), picker = $('picker'), picked = $('picked');
const runBtn = $('run'), resetBtn = $('reset');
const out = $('out'), errBox = $('err'), errText = $('errText');

let pyodide = null;
let api = null;
let files = [];

function status(text, cls) {
  rtText.textContent = text;
  rt.className = 'rt' + (cls ? ' ' + cls : '');
}

/* ------------------------------------------------------------- runtime */

async function boot() {
  try {
    // The host decides whether anything has to happen before the engine is
    // usable. On the web that is nothing; in the app it is the subscription
    // and professional-use gate, and it blocks here until it passes.
    if (!(await Shell.start())) return;

    status('Loading engine…', 'loading');
    const { loadPyodide } = await import('./pyodide/pyodide.mjs');
    pyodide = await loadPyodide({
      indexURL: new URL('./pyodide/', document.baseURI).href,
      stdout: () => {},
      stderr: (m) => console.warn('[py]', m),
    });

    status('Loading analyzer…', 'loading');
    const zip = await fetch('./analyzer.zip');
    if (!zip.ok) throw new Error(`analyzer.zip: HTTP ${zip.status}`);
    await pyodide.unpackArchive(await zip.arrayBuffer(), 'zip',
                                { extractDir: '/lib/analyzer' });
    pyodide.runPython('import sys; sys.path.insert(0, "/lib/analyzer")');

    api = pyodide.pyimport('browser_api');
    status('Engine ready', 'ready');
    syncRunButton();
  } catch (e) {
    console.error(e);
    status('Engine failed to load', 'failed');
    showError(
      `${e.message || e}. Reload the page; if it keeps failing, the browser may ` +
      `be blocking WebAssembly.`);
  }
}

/* ------------------------------------------------------------ file list */

const ALLOWED = /\.(pdf|xml)$/i;

function addFiles(list) {
  const rejected = [];
  for (const f of list) {
    if (!ALLOWED.test(f.name)) { rejected.push(f.name); continue; }
    if (!files.some((x) => x.name === f.name && x.size === f.size)) files.push(f);
  }
  if (rejected.length) {
    showError(`Only .pdf and .xml files are accepted — ignored ${rejected.join(', ')}.`);
  } else {
    hideError();
  }
  renderPicked();
}

function renderPicked() {
  picked.innerHTML = '';
  for (const [i, f] of files.entries()) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = `${f.name} · ${(f.size / 1024).toFixed(0)} KB`;
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.textContent = 'remove';
    rm.setAttribute('aria-label', `Remove ${f.name}`);
    rm.addEventListener('click', () => { files.splice(i, 1); renderPicked(); });
    li.append(name, rm);
    picked.append(li);
  }
  resetBtn.classList.toggle('hide', files.length === 0);
  syncRunButton();
}

function syncRunButton() {
  runBtn.disabled = !(api && files.length);
  runBtn.textContent = api ? 'Analyze' : 'Loading engine…';
}

drop.addEventListener('click', () => picker.click());
drop.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); picker.click(); }
});
picker.addEventListener('change', () => { addFiles(picker.files); picker.value = ''; });
['dragenter', 'dragover'].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));

resetBtn.addEventListener('click', () => {
  files = [];
  renderPicked();
  out.classList.add('hide');
  hideError();
  Shell.release();
  if (api) api.clear();
});

/* -------------------------------------------------------------- errors */

function showError(msg) { errText.textContent = msg; errBox.classList.remove('hide'); }
function hideError() { errBox.classList.add('hide'); }

/* ---------------------------------------------------------------- run */

runBtn.addEventListener('click', async () => {
  if (!api || !files.length) return;
  hideError();
  out.classList.add('hide');
  Shell.release();
  runBtn.disabled = true;
  status('Reading files…', 'loading');

  // Let the status paint before WebAssembly takes the main thread.
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

  try {
    api.clear();
    const names = [];
    for (const f of files) {
      const buf = new Uint8Array(await f.arrayBuffer());
      names.push(api.stage(f.name, buf));
    }

    status('Analyzing…', 'loading');
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

    const cfg = {
      files: names,
      program: $('program').value.trim(),
      min_score: parseInt($('minScore').value, 10) || 620,
      clean_months: parseInt($('cleanMonths').value, 10) || 0,
      collections_payoff: $('payoff').checked,
      file_ref: $('fileRef').value.trim(),
      prepared_for: $('preparedFor').value.trim(),
    };
    const res = JSON.parse(api.analyze(JSON.stringify(cfg)));

    // The parsed file lives in the virtual filesystem until told otherwise.
    // Drop it as soon as the findings exist; there is no reason to keep it.
    api.clear();

    if (!res.ok) {
      console.error(res.traceback);
      showError(res.error);
      status('Engine ready', 'ready');
      return;
    }
    render(res);
    status('Engine ready', 'ready');
  } catch (e) {
    console.error(e);
    showError(String(e.message || e));
    status('Engine ready', 'ready');
  } finally {
    runBtn.disabled = false;
  }
});

/* ------------------------------------------------------------- results */

const TITLE = (b) => b.charAt(0).toUpperCase() + b.slice(1);

function render(res) {
  const tally = $('tally');
  tally.innerHTML = '';
  const cells = [
    ['Middle score', res.middle ? `${res.middle[1]}` : '—'],
    ['Qualifying bureau', res.middle ? TITLE(res.middle[0]) : '—'],
    ['Accounts after merge', res.accounts],
    ['Matched 2+ bureaus', res.matched],
    ['Findings', res.findings.length],
    ['As of', res.as_of],
  ];
  for (const [k, v] of cells) {
    const d = document.createElement('div');
    d.innerHTML = `${k}<b></b>`;
    d.querySelector('b').textContent = v;
    tally.append(d);
  }

  const sb = $('sumTable').tBodies[0];
  sb.innerHTML = '';
  for (const r of res.summary) {
    const tr = sb.insertRow();
    const cellText = r.present
      ? [TITLE(r.bureau), r.score ?? '—', r.tradelines,
         r.utilization === null ? '—' : `${Math.round(r.utilization * 100)}%`,
         r.inquiries, r.pulled_on ?? '—']
      : [TITLE(r.bureau), 'not provided', '', '', '', ''];
    cellText.forEach((t, i) => {
      const td = tr.insertCell();
      td.textContent = t;
      if (i > 0) td.className = 'mono';
    });
  }

  const mid = $('midNote');
  mid.innerHTML = '';
  if (res.middle) {
    const n = document.createElement('div');
    n.className = 'note';
    n.innerHTML = '<span class="lbl">Where the effort goes</span>';
    n.append(document.createTextNode(
      `Underwriting reads the median of three, so the qualifying score is ` +
      `${res.middle[1]} at ${TITLE(res.middle[0])}. Points added at the highest ` +
      `bureau are wasted, and points added at the lowest are wasted until it ` +
      `passes the middle. Target ${TITLE(res.middle[0])}.`));
    mid.append(n);
  }
  if (res.merged_source) {
    const n = document.createElement('div');
    n.className = 'note stop';
    n.innerHTML = '<span class="lbl">Merged input</span>';
    n.append(document.createTextNode(
      'This file collapses per-bureau values, so missing credit limits and ' +
      'one-bureau late marks cannot be detected — their absence is a property ' +
      'of the input, not the borrower. Ask for the unmerged report.'));
    mid.append(n);
  }

  const fb = $('findTable').tBodies[0];
  fb.innerHTML = '';
  for (const f of res.findings) {
    const tr = fb.insertRow();
    const sev = tr.insertCell();
    sev.innerHTML = `<span class="sev ${f.severity}"></span>`;
    sev.querySelector('span').textContent = f.severity;

    const body = tr.insertCell();
    const code = document.createElement('div');
    code.className = 'code';
    code.textContent = f.code;
    const title = document.createElement('div');
    title.textContent = f.title;
    body.append(code, title);
    if (f.detail) {
      const d = document.createElement('div');
      d.className = 'ev';
      d.textContent = f.detail;
      body.append(d);
    }
    if (f.evidence && f.evidence.length) {
      const wrapEv = document.createElement('div');
      wrapEv.className = 'ev';
      const ul = document.createElement('ul');
      for (const line of f.evidence) {
        const li = document.createElement('li');
        li.textContent = line;
        ul.append(li);
      }
      wrapEv.append(ul);
      body.append(wrapEv);
    }
    // Multi-year payment grids are reconstructed positionally, so anything
    // resting on them is a guess. Saying so is the difference between a
    // finding and a claim.
    if (f.confident === false) {
      const lc = document.createElement('div');
      lc.className = 'lowconf';
      lc.textContent = 'Low confidence — grid alignment reconstructed';
      body.append(lc);
    }

    const where = tr.insertCell();
    where.className = 'mono';
    // A null bureau means the finding is not scoped to one, which is not the
    // same as "all three" — several of them name the relevant bureau in the
    // title instead. Saying "All" here would assert something untrue.
    where.textContent = f.bureau ? TITLE(f.bureau) : '—';
  }

  const slots = res.analyst_slots;
  $('slotNote').textContent = slots
    ? `The report is a draft: ${slots} judgment slot${slots === 1 ? '' : 's'} still ` +
      `read [ANALYST] and it is stamped NOT FOR RELEASE. Fill them before a client sees it.`
    : 'The report has no unfilled judgment slots.';

  const ref = ($('fileRef').value.trim() || 'analysis').replace(/[^\w.-]+/g, '-');
  Shell.offerDeliverables({
    ref,
    html: res.report_html,
    json: res.findings_json,
    middle: res.middle,
    findingCount: res.findings.length,
  });

  out.classList.remove('hide');
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  out.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
}

boot();
