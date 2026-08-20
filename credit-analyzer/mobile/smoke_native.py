#!/usr/bin/env python3
"""Drive the mobile bundle against a stubbed Capacitor bridge.

    python credit-analyzer/mobile/smoke_native.py --dist credit-analyzer/mobile/www

The web smoke test proves the engine survives WebAssembly. This one proves the
*native shell* is correct, which is a separate question and the one that
carries the compliance weight:

  · the gate blocks — the engine must not load until it passes
  · a borrower cannot get through by leaving the attestations unchecked
  · a build with no licence endpoint refuses to sign anyone in, rather than
    letting everyone through
  · the report reaches the platform's file and share APIs, since `<a download>`
    silently does nothing inside a web view

Capacitor's plugins only exist inside a real app, so they are stubbed here and
their calls recorded. That tests our logic, not Apple's — an actual device run
is still required before shipping, and the README says so.
"""

from __future__ import annotations

import argparse
import functools
import http.server
import socketserver
import sys
import threading
from pathlib import Path

HERE = Path(__file__).resolve().parent
FIXTURE = HERE.parent / "fixtures" / "synthetic_mismo.xml"

# Recorded plugin calls land on window.__calls so assertions can read them.
BRIDGE = """
window.__calls = [];
window.__files = {};
const rec = (name, args) => { window.__calls.push([name, args]); };
const store = {};
window.Capacitor = {
  isNativePlatform: () => true,
  Plugins: {
    Preferences: {
      async get({key}) { rec('Preferences.get', key); return {value: store[key] ?? null}; },
      async set({key, value}) { rec('Preferences.set', key); store[key] = value; },
      async remove({key}) { delete store[key]; },
    },
    Filesystem: {
      async writeFile({path, data}) {
        rec('Filesystem.writeFile', path);
        window.__files[path] = data;
        return {uri: 'file:///stub/' + path};
      },
      async getUri({path}) {
        if (!(path in window.__files)) throw new Error('missing ' + path);
        return {uri: 'file:///stub/' + path};
      },
      async deleteFile({path}) { rec('Filesystem.deleteFile', path); delete window.__files[path]; },
    },
    Share: {
      async share(opts) { rec('Share.share', opts.files || []); },
    },
    StatusBar: { async setOverlaysWebView() {} },
    App: { addListener() {} },
  },
};
// Directory/Encoding are enum re-exports in the real plugin.
window.Capacitor.Plugins.Filesystem.Directory = {Data: 'DATA', Documents: 'DOCUMENTS'};
window.Capacitor.Plugins.Filesystem.Encoding = {UTF8: 'utf8'};
"""

# A licence endpoint that always says yes, so the gate can be walked through.
STUB_LICENCE = """
window.ANALYZER_CONFIG = {
  licenceEndpoint: 'https://licence.invalid/verify',
  subscribeUrl: 'https://example.com/subscribe',
};
const realFetch = window.fetch;
window.fetch = async (url, opts) => {
  if (String(url).startsWith('https://licence.invalid/')) {
    window.__calls.push(['licence.verify', JSON.parse(opts.body).email]);
    return new Response(JSON.stringify({active: true, company: 'Stub Brokerage'}),
                        {status: 200, headers: {'Content-Type': 'application/json'}});
  }
  return realFetch(url, opts);
};
"""


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dist", default=str(HERE / "www"))
    ap.add_argument("--file", default=str(FIXTURE))
    ap.add_argument("--port", type=int, default=8908)
    ap.add_argument("--browser", default=None)
    args = ap.parse_args(argv)

    from playwright.sync_api import sync_playwright

    dist = Path(args.dist).resolve()
    if not (dist / "shell.js").exists():
        sys.exit(f"smoke_native.py: {dist} is not a build — run npm run build first")
    if "isNative: true" not in (dist / "shell.js").read_text():
        sys.exit("smoke_native.py: that build has the web shell, not the native one")

    srv = socketserver.TCPServer(("127.0.0.1", args.port),
                                 functools.partial(_Quiet, directory=str(dist)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{args.port}"

    failures: list[str] = []

    def check(cond, msg):
        if not cond:
            failures.append(msg)

    try:
        with sync_playwright() as p:
            launch = {"executable_path": args.browser} if args.browser else {}
            browser = p.chromium.launch(**launch)

            # ---- 1. a build with no licence endpoint must not let anyone in
            page = browser.new_page(reduced_motion="reduce")
            page.add_init_script(BRIDGE)
            page.goto(origin + "/", wait_until="load")
            page.wait_for_selector("#gate", timeout=60_000)
            page.fill("#g-nmls", "1234567")
            page.fill("#g-company", "Stub Brokerage")
            for box in ("#g-c1", "#g-c2", "#g-c3"):
                page.check(box)
            page.click(".gate-go")
            page.wait_for_selector("#g-email", timeout=30_000)
            page.fill("#g-email", "lo@brokerage.com")
            page.fill("#g-key", "KEY-1")
            page.click(".gate-go")
            page.wait_for_selector(".gate-err:not([hidden])", timeout=30_000)
            check("licence endpoint" in page.inner_text(".gate-err").lower(),
                  "unconfigured build should refuse sign-in, said: "
                  + page.inner_text(".gate-err"))
            check(page.is_visible("#gate"), "gate lifted without a licence")
            page.close()

            # ---- 2. attestation must not pass while a statement is unchecked
            page = browser.new_page(reduced_motion="reduce")
            page.add_init_script(BRIDGE)
            page.add_init_script(STUB_LICENCE)
            page.goto(origin + "/", wait_until="load")
            page.wait_for_selector("#gate", timeout=60_000)
            page.fill("#g-nmls", "1234567")
            page.fill("#g-company", "Stub Brokerage")
            page.check("#g-c1")
            page.check("#g-c2")          # third statement deliberately left off
            page.click(".gate-go")
            page.wait_for_selector(".gate-err:not([hidden])", timeout=30_000)
            check(page.is_visible("#g-c3"), "attestation passed with a box unchecked")

            # ---- 3. the full path: gate, analyse, save, share, history
            page.check("#g-c3")
            page.click(".gate-go")
            page.wait_for_selector("#g-email", timeout=30_000)
            page.fill("#g-email", "lo@brokerage.com")
            page.fill("#g-key", "KEY-1")
            page.click(".gate-go")
            page.wait_for_selector("#rt.ready", timeout=240_000)
            check(not page.is_visible("#gate"), "gate did not lift after sign-in")

            page.fill("#fileRef", "MOBILE-1")
            page.set_input_files("#picker", args.file)
            page.click("#run")
            page.wait_for_selector("#out:not(.hide)", timeout=240_000)
            check("576" in page.inner_text("#out"), "middle score missing from results")

            # Copy that talks about tabs and browsers is what makes a build read
            # as a repackaged website, which is the guideline 4.2 rejection.
            body = page.inner_text("body").lower()
            for word in ("close the tab", "in your browser", "inside this tab"):
                check(word not in body, f"app still says {word!r}")

            # inner_text reflects the rendered casing, and the button is
            # uppercased in CSS — compare case-insensitively.
            save = page.locator("#dlReport")
            check("save" in save.inner_text().lower(),
                  f"save button still reads {save.inner_text()!r} — "
                  "<a download> does nothing in a web view")
            check(save.get_attribute("href") is None,
                  "save button kept its href, so a web view would try to navigate")
            save.click()
            page.wait_for_function(
                "() => window.__calls.some(c => c[0] === 'Share.share')",
                timeout=30_000)

            calls = page.evaluate("window.__calls")
            names = [c[0] for c in calls]
            check("Filesystem.writeFile" in names, "report never written to the filesystem")
            check("Share.share" in names, "report never reached the share sheet")
            check("licence.verify" in names, "licence was never verified")

            written = page.evaluate("Object.keys(window.__files)")
            check("MOBILE-1.html" in written, f"report file not written, got {written}")
            check("MOBILE-1-findings.json" in written,
                  f"findings file not written, got {written}")

            page.wait_for_selector("#histSection:not([hidden])", timeout=30_000)
            check("MOBILE-1" in page.inner_text("#histList"),
                  "saved report missing from history")

            # ---- 4. delete really removes the file, not just the row
            page.click("#histList .hist-btn.danger")
            page.wait_for_function(
                "() => !Object.keys(window.__files).includes('MOBILE-1.html')",
                timeout=30_000)
            check("MOBILE-1" not in page.inner_text("#histList"),
                  "deleted report still listed")

            browser.close()
    finally:
        srv.shutdown()

    if failures:
        for f in failures:
            print(f"FAIL: {f}", file=sys.stderr)
        return 1
    print("smoke: gate holds, analysis runs, report reaches Files and the share sheet")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
