/* The native implementation of the host shell.
 *
 * Same contract as shell-web.js, so app.js and every Python module are
 * byte-identical between the web build and the app. What differs is what a
 * phone can do that a public web page should not:
 *
 *   · a gate, because subscribers must be mortgage professionals
 *   · real files — reports land in Files / Drive and go out via the share sheet
 *   · saved reports, so a loan officer can reopen last week's work
 *
 * The gate is not a paywall with a compliance story bolted on. It is the
 * compliance story. Everything built here rests on one fact: no consumer pays
 * for this. A borrower who subscribes to improve their own credit turns this
 * into a credit repair organization under 15 U.S.C. § 1679a(3), and the
 * advance-fee ban alone would make a subscription unlawful. So the check runs
 * before the engine loads, it cannot be dismissed, and the attestation is
 * recorded with a timestamp.
 *
 * Plugins are read off window.Capacitor.Plugins rather than imported, so this
 * ships as a plain script with no bundler in the build path.
 */

/* ---------------------------------------------------------------------------
 * Deployment configuration comes from mobile/app.config.json, which build.py
 * prepends to this file. The defaults below only apply when something has gone
 * wrong with that, and they are deliberately unusable: a build with no licence
 * endpoint refuses to sign anybody in, which is the correct failure. The
 * alternative — an app that lets everyone through — is the one that turns this
 * into a credit repair organization.
 * ------------------------------------------------------------------------- */
window.ANALYZER_CONFIG = Object.assign({
  // POST {email, key, app, v} -> {active: bool, reason?, seat?, company?}
  licenceEndpoint: null,
  subscribeUrl: null,
  subscribeLabel: 'Start one on the web',
}, window.ANALYZER_CONFIG || {});

window.Shell = (() => {
  const CFG = window.ANALYZER_CONFIG;
  const P = () => (window.Capacitor && window.Capacitor.Plugins) || {};

  // index.html is shared with the web build and knows nothing about this file,
  // so the native stylesheet loads itself.
  (() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'shell-native.css';
    document.head.append(link);
  })();

  // Directory and Encoding are named exports of @capacitor/filesystem, not
  // members of Capacitor.Plugins, and this file ships without a bundler so it
  // cannot import them. They are plain string enums; these are their values.
  //
  // DATA is the right home for a saved report on both platforms: on iOS it
  // resolves to the app's Documents directory, which UIFileSharingEnabled
  // surfaces in the Files app, and on Android it is app-private storage that
  // goes away when the app is uninstalled.
  const DIR_DATA = 'DATA';
  const ENC_UTF8 = 'utf8';

  const ATTESTATION_VERSION = 1;
  const K_ENTITLEMENT = 'entitlement';
  const K_ATTESTATION = 'attestation';
  const K_HISTORY = 'history';

  // How long a verified subscription keeps working with no connection. A loan
  // officer on a plane should not lose the tool, and an expired card should not
  // take a week to notice.
  const OFFLINE_GRACE_DAYS = 7;

  let lastRun = null;

  /* ------------------------------------------------------------- storage */

  async function get(key) {
    const { Preferences } = P();
    if (!Preferences) return null;
    const { value } = await Preferences.get({ key });
    try { return value ? JSON.parse(value) : null; } catch { return null; }
  }

  async function set(key, value) {
    const { Preferences } = P();
    if (!Preferences) return;
    await Preferences.set({ key, value: JSON.stringify(value) });
  }

  /* ---------------------------------------------------------- entitlement */

  /** Ask the licence server whether this account is currently subscribed.
   *
   *  Deliberately not in-app purchase. Both stores carve out business apps
   *  whose accounts are sold elsewhere (Apple's Enterprise Services guideline;
   *  the same shape as every B2B app that signs in with a work account), and
   *  billing on the web keeps the store's cut off a subscription that is not
   *  a consumer sale in the first place.
   */
  async function verifyLicence(email, key) {
    if (!CFG.licenceEndpoint) {
      throw new Error(
        'No licence endpoint is configured. Set licenceEndpoint in ' +
        'mobile/app.config.json before shipping a build.');
    }
    // The shipped config carries a placeholder host that does not resolve.
    // Caught here so an unconfigured build says what is wrong, instead of
    // failing later as an unexplained network error on someone's phone.
    if (/CHANGE-ME|YOUR-SUBDOMAIN/i.test(CFG.licenceEndpoint)) {
      throw new Error(
        'This build still has the placeholder licence endpoint. Run ' +
        '`npm run set-endpoint -- <your worker URL>` in credit-analyzer/mobile ' +
        'and rebuild.');
    }
    const res = await fetch(CFG.licenceEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, key, app: 'analyzer', v: 1 }),
    });
    if (!res.ok) throw new Error(`Licence check failed (HTTP ${res.status}).`);
    const data = await res.json();
    if (!data.active) {
      throw new Error(data.reason || 'That subscription is not active.');
    }
    return {
      email,
      key,
      seat: data.seat || null,
      company: data.company || null,
      verifiedAt: Date.now(),
    };
  }

  function graceRemaining(ent) {
    if (!ent || !ent.verifiedAt) return 0;
    const ms = OFFLINE_GRACE_DAYS * 864e5 - (Date.now() - ent.verifiedAt);
    return Math.max(0, ms);
  }

  /** Re-check in the background. Never blocks a launch that already passed. */
  async function refreshQuietly(ent) {
    try {
      const fresh = await verifyLicence(ent.email, ent.key);
      await set(K_ENTITLEMENT, fresh);
    } catch {
      // Offline or the server is down. The grace window covers it, and an
      // actually-cancelled subscription fails at the next successful check.
    }
  }

  /* ----------------------------------------------------------------- UI */

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function gateShell(title, lede) {
    let root = document.getElementById('gate');
    if (root) root.remove();
    root = el('div', 'gate');
    root.id = 'gate';
    const card = el('div', 'gate-card');
    card.append(el('div', 'gate-mark', 'Credit Analyzer'));
    const h = el('h1', null, title);
    card.append(h);
    if (lede) card.append(el('p', 'gate-lede', lede));
    root.append(card);
    document.body.append(root);
    return card;
  }

  function field(card, id, label, type, placeholder, extra = {}) {
    const wrap = el('div', 'gate-field');
    const l = el('label', null, label);
    l.setAttribute('for', id);
    const i = document.createElement('input');
    i.id = id;
    i.type = type;
    if (placeholder) i.placeholder = placeholder;
    Object.assign(i, extra);
    wrap.append(l, i);
    card.append(wrap);
    return i;
  }

  function checkbox(card, id, text) {
    const wrap = el('label', 'gate-check');
    const i = document.createElement('input');
    i.type = 'checkbox';
    i.id = id;
    wrap.append(i, el('span', null, text));
    card.append(wrap);
    return i;
  }

  /* --------------------------------------------------------- attestation */

  /** Who is allowed to use this, asked plainly and recorded.
   *
   *  Written as statements a person either can or cannot truthfully make,
   *  rather than a terms-of-service scroll nobody reads. If someone lies here
   *  that is on them — but nothing about the product invited a borrower in,
   *  and that is the distinction the whole business rests on.
   */
  function askAttestation() {
    return new Promise((resolve) => {
      const card = gateShell(
        'Who is using this',
        'This is a professional tool for people who originate or broker mortgage ' +
        'loans. It is not a consumer service, and it is not credit repair.');

      const nmls = field(card, 'g-nmls', 'NMLS ID or state licence number',
                         'text', 'e.g. 1234567', { autocapitalize: 'characters' });
      const company = field(card, 'g-company', 'Company', 'text', 'Brokerage or lender');

      const c1 = checkbox(card, 'g-c1',
        'I originate or broker mortgage loans, or I work on behalf of someone who does.');
      const c2 = checkbox(card, 'g-c2',
        'For every file I review, my company has a permissible purpose under the ' +
        'Fair Credit Reporting Act to hold that consumer report.');
      const c3 = checkbox(card, 'g-c3',
        'I will not charge any borrower for this analysis, or pass its cost to them.');

      const stop = el('div', 'gate-stop');
      stop.append(el('span', 'gate-stop-tag', 'If you are a borrower'));
      stop.append(el('p', null,
        'This tool is not for you, and subscribing would not help you. Your own ' +
        'three reports are free at annualcreditreport.com, and the free web ' +
        'version of this analyzer reads them without an account.'));
      card.append(stop);

      const err = el('p', 'gate-err');
      err.hidden = true;
      card.append(err);

      const go = el('button', 'gate-go', 'Continue');
      go.type = 'button';
      card.append(go);

      go.addEventListener('click', async () => {
        if (!nmls.value.trim() || !company.value.trim()) {
          err.textContent = 'Enter your licence number and company.';
          err.hidden = false;
          return;
        }
        if (!c1.checked || !c2.checked || !c3.checked) {
          err.textContent = 'All three statements have to be true to continue.';
          err.hidden = false;
          return;
        }
        await set(K_ATTESTATION, {
          version: ATTESTATION_VERSION,
          nmls: nmls.value.trim(),
          company: company.value.trim(),
          acceptedAt: new Date().toISOString(),
        });
        resolve(true);
      });
    });
  }

  /* --------------------------------------------------------------- sign in */

  function askSignIn(message) {
    return new Promise((resolve) => {
      const card = gateShell(
        'Sign in',
        'Subscriptions are managed on the web. Sign in with the address you ' +
        'subscribed with.');

      const email = field(card, 'g-email', 'Email', 'email', 'you@brokerage.com',
                          { autocapitalize: 'none', autocomplete: 'email' });
      const key = field(card, 'g-key', 'Licence key', 'text', 'From your receipt',
                        { autocapitalize: 'characters' });

      const err = el('p', 'gate-err');
      err.hidden = true;
      if (message) { err.textContent = message; err.hidden = false; }
      card.append(err);

      const go = el('button', 'gate-go', 'Sign in');
      go.type = 'button';
      card.append(go);

      const help = el('p', 'gate-help');
      help.append(document.createTextNode('No subscription yet? '));
      const a = el('a', null, CFG.subscribeLabel || 'Start one on the web');
      a.href = CFG.subscribeUrl || '#';
      a.target = '_blank';
      a.rel = 'noopener';
      help.append(a);
      help.append(document.createTextNode(
        '. Billing is handled on our site, not through the app store.'));
      card.append(help);

      go.addEventListener('click', async () => {
        err.hidden = true;
        go.disabled = true;
        go.textContent = 'Checking…';
        try {
          const ent = await verifyLicence(email.value.trim().toLowerCase(),
                                          key.value.trim());
          await set(K_ENTITLEMENT, ent);
          resolve(true);
        } catch (e) {
          err.textContent = e.message || String(e);
          err.hidden = false;
          go.disabled = false;
          go.textContent = 'Sign in';
        }
      });
    });
  }

  function dismissGate() {
    const g = document.getElementById('gate');
    if (g) g.remove();
  }

  /** index.html is written for the web and says so out loud. Inside the app
   *  "runs in your browser" and "close the tab" are simply wrong, and copy
   *  that talks about tabs is the first thing that makes a build read as a
   *  repackaged website — which is the guideline 4.2 rejection. */
  function rewriteForApp() {
    const sub = document.querySelector('.brand span');
    if (sub) sub.textContent = 'Tri-merge review · runs on this device';

    const note = document.querySelector('.note.good');
    if (note) {
      note.innerHTML = '';
      const lbl = el('span', 'lbl', 'Nothing is uploaded');
      note.append(lbl, document.createTextNode(
        'Python runs on this device as WebAssembly. The credit file is read ' +
        'here and never crosses the network — there is no server to send it ' +
        'to, and the app works with no connection at all.'));
    }

    const foot = document.querySelector('footer');
    if (foot) {
      foot.innerHTML = '';
      foot.append(document.createTextNode(
        'EVERY ANALYSIS RUNS ON THIS DEVICE. NO FILE, NO FINDING AND NO REPORT ' +
        'IS TRANSMITTED, STORED OR LOGGED ANYWHERE. SAVED REPORTS STAY ON THIS ' +
        'DEVICE UNTIL YOU DELETE THEM.'));
      foot.append(document.createElement('br'));
      foot.append(document.createElement('br'));
      foot.append(document.createTextNode(
        'A PROFESSIONAL TOOL FOR MORTGAGE ORIGINATORS. NOT A CONSUMER SERVICE, ' +
        'NOT CREDIT REPAIR, AND NOT LEGAL OR FINANCIAL ADVICE. FINDINGS ARE ' +
        'MACHINE-GENERATED CANDIDATES REQUIRING HUMAN REVIEW BEFORE ANY CLIENT ' +
        'SEES THEM.'));
    }
  }

  /* ------------------------------------------------------------- history */

  async function history() {
    return (await get(K_HISTORY)) || [];
  }

  async function remember(entry) {
    const list = await history();
    list.unshift(entry);
    await set(K_HISTORY, list.slice(0, 50));
    await renderHistory();
  }

  async function forget(id) {
    const { Filesystem } = P();
    const list = await history();
    const hit = list.find((e) => e.id === id);
    if (hit && Filesystem) {
      for (const path of [hit.reportPath, hit.jsonPath].filter(Boolean)) {
        try {
          await Filesystem.deleteFile({ path, directory: DIR_DATA });
        } catch { /* already gone */ }
      }
    }
    await set(K_HISTORY, list.filter((e) => e.id !== id));
    await renderHistory();
  }

  async function renderHistory() {
    let sec = document.getElementById('histSection');
    const list = await history();
    if (!sec) {
      sec = el('section', null);
      sec.id = 'histSection';
      const h = el('h2', null, 'Saved reports');
      sec.append(h);
      const ul = el('ul', 'hist');
      ul.id = 'histList';
      sec.append(ul);
      document.querySelector('.wrap').insertBefore(
        sec, document.getElementById('out'));
    }
    sec.hidden = list.length === 0;
    const ul = document.getElementById('histList');
    ul.innerHTML = '';
    for (const e of list) {
      const li = el('li');
      const main = el('div', 'hist-main');
      main.append(el('div', 'hist-ref', e.ref));
      main.append(el('div', 'hist-meta',
        [new Date(e.at).toLocaleDateString(),
         e.middle ? `middle ${e.middle}` : null,
         `${e.findingCount} findings`].filter(Boolean).join(' · ')));
      const actions = el('div', 'hist-actions');
      const open = el('button', 'hist-btn', 'Open');
      open.type = 'button';
      open.addEventListener('click', () => shareSaved(e));
      const del = el('button', 'hist-btn danger', 'Delete');
      del.type = 'button';
      del.addEventListener('click', () => forget(e.id));
      actions.append(open, del);
      li.append(main, actions);
      ul.append(li);
    }
  }

  /* ------------------------------------------------------------ delivery */

  async function writeFile(name, data, mime) {
    const { Filesystem } = P();
    if (!Filesystem) throw new Error('Filesystem plugin is unavailable.');
    await Filesystem.writeFile({
      path: name,
      data,
      directory: DIR_DATA,
      encoding: ENC_UTF8,
      recursive: true,
    });
    const { uri } = await Filesystem.getUri({ path: name, directory: DIR_DATA });
    return { path: name, uri, mime };
  }

  async function shareFiles(title, uris) {
    const { Share } = P();
    if (!Share) throw new Error('Share plugin is unavailable.');
    await Share.share({ title, files: uris });
  }

  async function shareSaved(entry) {
    const { Filesystem } = P();
    try {
      const uris = [];
      for (const path of [entry.reportPath, entry.jsonPath].filter(Boolean)) {
        const { uri } = await Filesystem.getUri({ path, directory: DIR_DATA });
        uris.push(uri);
      }
      await shareFiles(entry.ref, uris);
    } catch (e) {
      alert(`That report is no longer on this device.\n\n${e.message || e}`);
      await forget(entry.id);
    }
  }

  /* -------------------------------------------------------------- public */

  return {
    isNative: true,

    async start() {
      const { StatusBar, App } = P();
      if (StatusBar) {
        try { await StatusBar.setOverlaysWebView({ overlay: false }); } catch { /* android only */ }
      }
      document.body.classList.add('native');

      if (!(await get(K_ATTESTATION))) {
        await askAttestation();
      }

      let ent = await get(K_ENTITLEMENT);
      if (!ent) {
        await askSignIn();
        ent = await get(K_ENTITLEMENT);
      } else if (graceRemaining(ent) <= 0) {
        // The last successful check is older than the offline window, so this
        // is no longer a subscription we can vouch for.
        await askSignIn('Your subscription needs re-checking. Sign in again.');
      } else {
        refreshQuietly(ent);
      }

      dismissGate();
      rewriteForApp();
      await renderHistory();

      if (App) {
        App.addListener('backButton', ({ canGoBack }) => {
          if (!canGoBack) App.exitApp();
        });
      }
      return true;
    },

    async offerDeliverables({ ref, html, json, middle, findingCount }) {
      lastRun = { ref, html, json, middle, findingCount };

      const report = document.getElementById('dlReport');
      const open = document.getElementById('openReport');
      const findings = document.getElementById('dlJson');

      // <a download> does nothing in a web view. These become buttons that go
      // through the platform's own file and share machinery instead.
      report.textContent = 'Save to Files';
      open.textContent = 'Share report';
      findings.textContent = 'Save findings.json';
      for (const a of [report, open, findings]) a.removeAttribute('href');

      report.onclick = async (e) => {
        e.preventDefault();
        try {
          const f = await writeFile(`${ref}.html`, html, 'text/html');
          const j = await writeFile(`${ref}-findings.json`, json, 'application/json');
          await remember({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            ref, at: Date.now(), middle: middle ? middle[1] : null, findingCount,
            reportPath: f.path, jsonPath: j.path,
          });
          await shareFiles(ref, [f.uri, j.uri]);
        } catch (err) {
          alert(`Could not save the report.\n\n${err.message || err}`);
        }
      };

      open.onclick = async (e) => {
        e.preventDefault();
        try {
          const f = await writeFile(`${ref}.html`, html, 'text/html');
          await shareFiles(ref, [f.uri]);
        } catch (err) {
          alert(`Could not share the report.\n\n${err.message || err}`);
        }
      };

      findings.onclick = async (e) => {
        e.preventDefault();
        try {
          const j = await writeFile(`${ref}-findings.json`, json, 'application/json');
          await shareFiles(`${ref} findings`, [j.uri]);
        } catch (err) {
          alert(`Could not save the findings.\n\n${err.message || err}`);
        }
      };
    },

    release() { lastRun = null; },
  };
})();
