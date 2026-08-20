# Working in this repo

Two unrelated products share this repository and one GitHub Pages deploy:

- **the salon site** — React + Vite + Tailwind, at the repo root, serving
  `fmercadx.github.io/margot-prisma/`
- **`credit-analyzer/`** — a tri-merge credit analysis tool, serving
  `fmercadx.github.io/margot-prisma/analyzer/`

They are independent. `deploy.yml` builds both into one `dist/`, and
`credit-analyzer.yml` is path-filtered so salon changes never run its tests.

---

## Never commit a consumer credit report

`credit-analyzer/fixtures/` is gitignored except for `synthetic_*` files. Git
history is permanent and survives any later change in repository visibility,
and this repo is public with a live Pages site.

CI hard-fails if a non-synthetic file is tracked under `fixtures/`. Do not
weaken that gate. Tests run on synthetic tradelines for exactly this reason.

---

## Constraints that are the product, not preferences

These look like implementation details and are not. Changing any of them
changes the legal posture of the business.

**No consumer ever pays.** The analyzer is sold to mortgage originators, never
to borrowers. A borrower who pays to improve their own credit makes this a
credit repair organization under 15 U.S.C. § 1679a(3), and CROA's advance-fee
ban (§ 1679b(b)) then makes a subscription unlawful outright. So: no
consumer-facing signup, no borrower checkout, no in-app purchase. The mobile
gate (`mobile/shell-native.js`) enforces this before the engine loads and is
not a paywall to be simplified away.

**Fees are per file reviewed, never per loan closed.** Clients originate
federally related mortgage loans, which puts RESPA § 8 in play. A fee that
tracks closings reads as a referral fee whatever it is called.

**Nothing leaves the machine.** The browser and mobile builds vendor the whole
runtime — Pyodide, the Python stdlib, pypdf — rather than fetching from a CDN.
`browser/smoke.py` asserts **zero off-origin requests**. The only network call
in the entire product is the mobile licence check.

**Findings are candidates, not conclusions.** The report renders unresolved
judgment calls as visible `[ANALYST]` markers and stamps itself
`NOT FOR RELEASE`. Never replace those with plausible filler.

---

## Commands

Paths below are relative to the **repo root** unless a `cd` is shown. Several
scripts take repo-root-relative paths but are invoked from elsewhere — running
them from the wrong directory is the single most common mistake here.

```bash
# Python: 97 tests
cd credit-analyzer && ANALYZER_PASSWORD=ci-test-password-1234 \
  ANALYZER_SECURE_COOKIE=0 python -m pytest test_analyzer.py web/test_web.py -q

# Web build + in-browser smoke test
npm ci && npm run build:analyzer
python3 credit-analyzer/browser/smoke.py --dist dist/analyzer

# Mobile build + native shell smoke test
cd credit-analyzer/mobile && npm ci && npm run build && cd ../..
python3 credit-analyzer/mobile/smoke_native.py

# Licence worker: 21 tests.  Endpoint wiring: 7 tests.
cd credit-analyzer/licence && npm test
cd credit-analyzer/mobile  && npm test
```

The smoke scripts take `--browser <path>` if Playwright's Chromium is not on
the default path, and `--port` if the default is in use.

---

## Two mistakes that cost real time here

**Reset the branch from `main` immediately after every squash merge.** PRs are
squash-merged, so the merged commit gets a new SHA and the feature branch's
original commits are no longer ancestors of `main`. Continuing to commit on the
old base silently duplicates merged work; GitHub then marks the next PR
`mergeable_state: dirty` and creates **no CI run at all**, which looks like CI
being slow rather than a conflict.

```bash
git fetch origin main && git checkout -B <branch> origin/main
```

Before force-pushing over a diverged branch, check *content*, not ancestry —
`git merge-base --is-ancestor` always says "not merged" after a squash. Use
`git diff <old-head> origin/main`; empty means the work is safely in.

**`credit-analyzer.yml` defaults every step to `credit-analyzer/`.** A step
that writes a repo-root-relative path without overriding `working-directory`
resolves one level too deep. Set `working-directory` explicitly on every step
in the `browser` job.

---

## Architecture worth knowing before editing

**One engine, two hosts.** `browser/app.js` and every Python module are
byte-identical between the web page and the mobile app. Exactly one file
differs and `build.py --target` picks it:

| Target | Shell | Behaviour |
| --- | --- | --- |
| `web` | `browser/shell-web.js` | Blob downloads, no gate, nothing retained |
| `mobile` | `mobile/shell-native.js` | Files + share sheet, saved reports, gate |

Anything host-specific belongs behind that seam. If a change to `app.js` needs
to know where it is running, it is in the wrong file.

**`<a download>` does nothing in a web view.** The native shell rewires those
buttons through the platform's file and share APIs; `smoke_native.py` asserts
it did.

**The page must not scroll sideways at 390px.** Wide tables scroll inside their
own `overflow-x: auto` container; the document never does. A single
`white-space: nowrap` on prose broke this once and shipped. `smoke.py` checks
it at phone width and names the offending element.

---

## This remote environment

Outbound access is allowlisted: **Anthropic, npm, PyPI, crates, Go, and local
addresses only.** Everything else answers `403` to CONNECT — including
`api.cloudflare.com`, `workers.dev`, Railway, and `fmercadx.github.io` itself.

So deploys that need those hosts cannot be done from here, and the live Pages
site cannot be fetched to verify. Check with
`curl -sS "$HTTPS_PROXY/__agentproxy/status"` rather than assuming either way.

Chromium for Playwright is at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.
Do not run `playwright install`.
