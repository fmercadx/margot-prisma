# Working in this repo

Seven unrelated products share this repository:

- **the salon site** — React + Vite + Tailwind, at the repo root, serving
  `fmercadx.github.io/margot-prisma/`
- **`credit-analyzer/`** — a tri-merge credit analysis tool, serving
  `fmercadx.github.io/margot-prisma/analyzer/`
- **`shepherds-whisper/`** — the marketing site for an Oregon adult foster
  home. Railway is its real home, because only there does its server run and
  the tour form reach an inbox; a static copy also ships to Pages at
  `fmercadx.github.io/margot-prisma/shepherds-whisper/`, where `/api/tour-request`
  is absent and the form falls back to a prefilled email
- **`car-mirror/`** — an Android app that mirrors the owner's phone screen to
  their Tesla's browser. Its own Gradle build; ships as an APK on GitHub
  Releases, not on Pages or Railway. Its README explains the design.
- **`takeoff/`** — counts symbols on CAD-exported electrical drawings from one
  clicked example, and measures circuits, conduit and wire in feet at the
  printed scale. A Python command-line tool, and a click screen serving
  `fmercadx.github.io/margot-prisma/takeoff/` that runs the same modules in the
  browser.
- **`plan-takeoff/`** — a plan takeoff tool: reads every repeated symbol,
  hatch, polygon and line off a CAD-exported PDF unprompted and reports counts,
  areas and lengths; JavaScript, in the browser, serving
  `fmercadx.github.io/margot-prisma/plan-takeoff/`. Shares no code with
  `takeoff/`; whether they stay two tools is an open decision
- **`personal-daily-hub/`** — a React Native + Expo (SDK 58) daily dashboard
  app; built for phones through EAS, not deployed from this repo

They are independent. `deploy.yml` builds the salon site, the analyzer, the
takeoff page, the adult foster home site and the plan takeoff tool into one
`dist/`, and `credit-analyzer.yml`, `shepherds-whisper.yml`, `car-mirror.yml`,
`takeoff.yml`, `plan-takeoff.yml` and the three `personal-daily-hub*`
workflows are path-filtered so no product's changes run another's tests. `car-mirror.yml` alone also runs on branch pushes, because each
build publishes a release; its `scope` job skips a branch that hasn't changed
car-mirror since it left `main`, since GitHub runs path-filtered workflows on new
branches and force-pushes anyway. `personal-daily-hub-android.yml` also builds
on branch pushes, but only uploads artifacts (the APK, and screenshots from
running it on an emulator); it publishes nothing. `personal-daily-hub-ios.yml`
does the same for iOS on a macOS runner: a Simulator build (signed ad hoc, no
Apple account; unsigned, it gets no Keychain and the app refuses to save),
driven with Maestro, uploaded as artifacts.

**`car-mirror/` network exposure is deliberate.** Its VPN covers only the app
and routes a single link-local `/32` (link-local because Android 13+ drops
packets from other interfaces to any other VPN address). Its server listens on
all addresses but closes connections that don't arrive on that address or the
hotspot's own (`acceptLocal`), and checks the Host header. Nothing that shows
the screen or touches the phone is served without an encrypted session, and a
session needs a car the user paired on the phone by comparing a 6-digit code
(`core/Pairing.kt`): frames (JPEG or H.264), status and taps are ChaCha20-Poly1305 with
replay-checked counters, and the server never sends CORS headers. The page's
crypto (`crypto.js`, noble) is vendored and served by the phone. Widening any of
these would let whoever shares a network with the phone, or any page open in the
car's browser, see the screen or tap on the phone.

**`personal-daily-hub/` security is easy to undo by accident.** All of these
are tested, but each looks like an implementation detail:

- Every stored value goes through the codec in `src/lib/storage.ts`
  (AES-256-GCM on phones). Never call AsyncStorage directly for app data,
  and never log a decrypted value.
- `src/lib/dataCodec.ts` creates the key only when none is stored. If reading
  it throws, launch fails safe (saving off); minting a new key there would
  orphan everything sealed with the old one. The one deliberate exception is
  Erase everything (`erase` in `useDailyHub.ts`): it drains the writer,
  removes the data, then deletes the key, in that order, before a new key
  is made.
- The release APK has no INTERNET permission (`app.config.js`, set by the APK
  workflow), and the emulator test asserts it. A network feature means
  revisiting that, not quietly re-adding the permission.
- `locked` in `src/hooks/useAppLock.ts` is derived during render. Moving it
  into an effect draws the day for one frame before the lock screen.

**Two Railway services, two configs.** The root `railway.json` and `Procfile`
belong to the credit analyzer's Flask app. `shepherds-whisper/railway.json` and
`shepherds-whisper/nixpacks.toml` belong to the site, and its Railway service
must have its root directory set to `shepherds-whisper` — otherwise it builds
from the repo root and deploys the analyzer instead. Do not merge the two.

---

## Never commit a consumer credit report

`credit-analyzer/fixtures/` is gitignored except for `synthetic_*` files. Git
history is permanent and survives any later change in repository visibility,
and this repo is public with a live Pages site.

CI hard-fails if a non-synthetic file is tracked under `fixtures/`. Do not
weaken that gate. Tests run on synthetic tradelines for exactly this reason.

## Never commit a drawing set

Construction drawings belong to the architects and engineers who drew them,
even when an agency posts them publicly for bidding. `takeoff/` gitignores PDFs
and images, and `takeoff.yml` fails if one is tracked there. Test against real
sets from a scratch directory; the tests build a synthetic set at run time.
Nothing rendered from a real set goes into marketing without written permission.

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

## `shepherds-whisper/` — what must not be invented

A licensed adult foster home is a regulated care provider, and the site is read
by families choosing where a parent will live. The copy follows **Oregon** law —
"adult foster home", the five-or-fewer cap from ORS 443.705, ODHS as the
licensing agency, and Class 1/2/3 licences. Washington's Adult Family Home rules
are a different statute with a different cap; do not mix the two. Three things are therefore left
empty rather than filled with plausible text, and each degrades gracefully until
it is filled in for real:

- **Licence number, address, phone, capacity.** All in
  `src/content/business.ts`; blank fields are hidden, not rendered empty. Never
  invent one to make a page look finished.
- **Testimonials.** `src/content/testimonials.ts` ships empty and the section
  does not render. Fabricated endorsements are deceptive advertising under
  16 CFR Part 255.
- **Caregivers.** `src/content/caregivers.ts` ships empty; the section falls back
  to the standards every caregiver is held to. Those four are safe to state
  unpeopled because three are conditions of holding the licence. Never invent a
  caregiver — families expect to meet them.
- **Photographs.** `src/photos/` ships original illustrations, and a raster file
  dropped in beside one overrides it. Alt text says "Illustration —" while a
  slot holds a drawing. Stock photos of another home would misrepresent this one.

The privacy page at `src/pages/Privacy.tsx` describes what the code actually
does with an enquiry — the care-needs list, Resend, the one-hour IP window, and
the deploy-log fallback when a send fails. Change any of those and the page is
untrue until it is changed too; `npm run test:privacy` asserts each claim is
still on the page. Its effective date and privacy contact render as visible
markers until set, and the page says it is not yet in effect while they are.

Its own README covers the deploy and the rest of the reasoning.

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

# The adult family home site: build, then browser checks against dist/
cd shepherds-whisper && npm ci && npm run build && npm run smoke

# Its Pages copy. SITE_BASE/SITE_OUT move the base and output; the script also
# writes privacy/index.html, because Pages has no SPA fallback and a direct hit
# on a route would otherwise 404. Build from the repo root — dist/ lives there.
npm run build:whisper
cd shepherds-whisper && npm run test:pages

# Takeoff: 56 tests on synthetic drawing sets. Real sets stay outside the repo.
cd takeoff && python -m pytest test_takeoff.py -q

# Takeoff click screen: build (needs `npm ci`; fetches Pyodide's numpy and
# cryptography wheels from cdn.jsdelivr.net once, into takeoff/browser/.cache),
# then drive it in Chromium.
npm ci && npm run build:takeoff
python3 takeoff/browser/smoke.py --dist dist/takeoff

# Plan takeoff: 13 engine tests, build into dist/plan-takeoff, browser smoke test
cd plan-takeoff && npm ci && npm test && npm run build && cd ..
python3 plan-takeoff/smoke.py --dist dist/plan-takeoff

# Car mirror: core tests (JDK only), then the viewer page in Chromium.
# The APK itself cannot build here (dl.google.com is blocked); CI builds it.
# Maven Central sometimes answers 429 through the proxy: just rerun.
cd car-mirror && ./gradlew -PcoreOnly :core:test
cd car-mirror && ./gradlew -PcoreOnly :core:demoServer --args="8090 --control $PWD/build/smoke" &   # wait for READY
cd car-mirror && NODE_PATH=$(npm root -g) node tools/viewer-smoke.cjs http://127.0.0.1:8090/ --control $PWD/build/smoke
# Video mode the same way, on a fresh demo phone (needs a Chromium that plays H.264 via MSE).
cd car-mirror && ./gradlew -PcoreOnly :core:demoServer --args="8091 --control $PWD/build/video --video" &
cd car-mirror && NODE_PATH=$(npm root -g) node tools/video-smoke.cjs http://127.0.0.1:8091/ --control $PWD/build/video

# Car mirror phone-screen previews: Robolectric renders the real screen in each state.
# CI only (needs Google Maven); the PNGs are attached to each release as preview-*.png.
cd car-mirror && ./gradlew :app:testDebugUnitTest

# The daily hub app: types, Jest (every test runs as iOS and as Android),
# then bundle every platform. `expo install`, `expo export` and
# `expo prebuild` need EXPO_OFFLINE=1 here — see below. Gradle cannot run
# here (Maven is not on the allowlist); personal-daily-hub-android.yml
# builds the APK on GitHub instead. Xcode cannot run here either (no macOS);
# personal-daily-hub-ios.yml builds and runs the iOS app on GitHub.
cd personal-daily-hub && npm ci && npm run typecheck && npm test
EXPO_OFFLINE=1 npx expo export --platform android --platform ios --platform web --output-dir dist
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

**The takeoff page runs numpy as 32-bit WebAssembly.** Its `intp` is 32-bit
there, so `np.repeat` and friends reject int64 counts that work everywhere on a
desktop. Use `np.intp` for anything used as a count or index; `smoke.py` is the
only place that catches it. The page uses PDF.js's legacy build because the
modern one needs browser features only the newest have.

**`<a download>` does nothing in a web view.** The native shell rewires those
buttons through the platform's file and share APIs; `smoke_native.py` asserts
it did.

**`plan-takeoff/` is JavaScript, not Python.** Its engine (`plan-takeoff/src/engine/`)
takes pdf.js's `OPS` table as an argument and never imports pdf.js, so the
Node tests run it against the real operator list with no browser. The page
imports the `legacy` pdf.js build on purpose: the default build assumes the
newest browser and threw on the Chromium in this container.

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
site cannot be fetched to verify. The Expo CLI calls `api.expo.dev` to check
versions and fails on the 403; `EXPO_OFFLINE=1` makes `npx expo install` use
the SDK's bundled version map instead, and `docs.expo.dev` is unreachable, so
read the installed packages' `.d.ts` files for current APIs. Check with
`curl -sS "$HTTPS_PROXY/__agentproxy/status"` rather than assuming either way.

Chromium for Playwright is at `/opt/pw-browsers/chromium` (a symlink the image
keeps pointing at the current build; the versioned path changes).
Do not run `playwright install`.
