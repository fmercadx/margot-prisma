# The Shepherd's Whisper AFH — website

Marketing site for a licensed Oregon adult foster home. React + Vite + Tailwind,
served in production by a dependency-free Node static server, deployed on
Railway.

It is a third, independent product in this repository. It does not share code,
build, or deploy with the salon site at the repo root or with
`credit-analyzer/`, and its CI is path-filtered so the three never trigger each
other.

---

## Before it goes live

The site is built and deployable as it stands, but six facts are not in it,
because inventing them would be worse than leaving them out — a made-up licence
number or address on a regulated care provider's site is a real problem, not a
placeholder to tidy up later.

All six live in **`src/content/business.ts`** and nowhere else. Anything still
blank is hidden rather than rendered empty, so the page stays presentable while
you fill them in one at a time.

| Field | What it turns on |
| --- | --- |
| `phone` | Call buttons in the header, hero, FAQ, wizard and footer. Until it is set, every CTA points at the tour form instead. |
| `email` | The footer contact row, and the wizard's fallback delivery (see below). |
| `address` | The footer address block and its map link. |
| `licenceNumber` | The number beside the licence badge and in the FAQ answer. |
| `licenceClass` | Names your Oregon licence class (1, 2 or 3) in the FAQ. |
| `capacity` | The resident-count figures in the trust bar. |
| `city` | The locality shown in the hero badge and the footer. |

**One URL still needs replacing.** `licensingUrl` points at the ODHS front door
(`oregon.gov/odhs`) because the deep link could not be verified from the build
environment. Swap in the department's adult foster home licensing or provider
lookup page — the footer's "Look up our inspection record" link and the FAQ both
use it.

The site is written for **Oregon**: "adult foster home" throughout, the
five-or-fewer resident cap from ORS 443.705, ODHS as the licensing agency, and
an FAQ answer about Oregon's Class 1/2/3 licence. Set `licenceClass` in
`business.ts` and that answer names yours instead of explaining the system
generically.

Two more things worth knowing:

- **Caregiver profiles are optional.** `src/content/caregivers.ts` ships empty,
  and the section still renders — it shows the standards every caregiver here is
  held to instead of profiles, so the page says something substantial before you
  have added anyone. Add people and their cards appear above those standards.
  For a portrait, drop `team-<slug>.jpg` into `src/photos/` and point `photo` at
  that slot; without one the card shows their initials, which looks deliberate
  rather than missing. Never invent a caregiver — a family reads those names
  expecting to meet them on the tour.
- **Testimonials are switched off** until real ones exist. `src/content/testimonials.ts`
  ships empty and the section does not render at all while it is. Fabricated
  reviews on a care home's site are deceptive advertising under the FTC's
  endorsement rules, so they are not something to fill in with plausible text.
- **Artwork**: the site ships with original illustrations in `src/photos/`,
  drawn in its palette. Photographs of the real house override them with no code
  change — drop a file named after the slot in beside the `.svg` and raster wins.
  See `src/photos/README.md` for the slot names and the shot list. Replace them
  with real photographs before the site is doing real work: captioning someone
  else's interior as your own is deceptive advertising, and a touring family
  notices. Get written consent before publishing any photograph showing a
  resident.

## Where the tour requests go

The three-step wizard needs somewhere to send an enquiry. It has two modes and
never silently drops one:

1. **`VITE_FORM_ENDPOINT` set** (a Railway build variable) — the wizard POSTs
   the enquiry as JSON to that URL and shows a confirmation on a 2xx, or an
   error with the phone number on a failure.
2. **Not set** — it opens a prefilled email to `business.email`. If that is
   blank too, the confirmation screen asks the visitor to call instead.

Set the variable at **build** time, not deploy time: Vite inlines it into the
bundle, so changing it needs a redeploy.

---

## Commands

All paths below are relative to `shepherds-whisper/`.

```bash
npm install
npm run dev                  # local dev server
npm run build                # tsc -b, then vite build into dist/
npm start                    # serve dist/ exactly as Railway does
npm run smoke                # browser checks against dist/ (build first)
```

`npm run smoke` takes `--browser <path>` if Chromium is not where it expects,
and `--port` if 4173 is in use.

### One file you can send someone

```bash
npm run build && npm run standalone     # -> dist/standalone.html
npm run standalone -- --skip-checks     # build it without opening a browser
```

`standalone.mjs` folds the whole site — CSS, JavaScript, and all nine
illustrations — into a single HTML file that fetches nothing at runtime. Useful
before a domain exists: it can be opened straight from disk, or published
somewhere with a content-security policy that blocks off-origin requests.
Google Fonts stays a `<link>`, since that is the one external host such policies
tend to allow and `index.css` declares a full fallback stack anyway.

It re-runs the important checks against the packaged file rather than trusting
that inlining worked — every illustration present and loading, nothing
off-origin but fonts, the wizard advancing through all three steps, and no
sideways scroll at 390px. Regenerate it after editing `business.ts` so the
shareable copy carries your real phone number.

---

## Deploying to Railway

The service is configured entirely from files in this folder, so there is
nothing to click through beyond pointing Railway at it.

```bash
npm i -g @railway/cli
railway login
railway link                 # or `railway init` for a new project
railway up
```

**Set the service's root directory to `shepherds-whisper`** in Railway's
settings. Without it, Railway builds from the repository root and deploys the
credit analyzer's Flask app instead — the root `railway.json` belongs to that
service, and this one must be a separate Railway service pointing here.

- `nixpacks.toml` pins Node 22 and drives install → build → start.
- `railway.json` sets the start command and a `/healthz` healthcheck.
- `server.mjs` binds `0.0.0.0:$PORT`.

Once it is up, add the custom domain under the service's **Settings → Networking**
and point the registrar's CNAME at the value Railway gives you.

### What the server does

`server.mjs` has no dependencies — it is Node's own `http` and `fs`. It serves
`dist/`, falls back to the app shell for extension-less paths so deep links
work, still 404s missing assets, gzips text, sends `immutable` caching only for
Vite's fingerprinted `/assets/` and `must-revalidate` for everything else, and
refuses paths that resolve outside `dist/`.

---

## Notes for whoever edits this next

- **Everything factual lives in `src/content/business.ts`.** No component
  hardcodes a phone number, an address, or a licence number, and structured
  data for search engines is generated from the same file in `src/seo.ts`.
  Changing a fact is a one-line edit that cannot leave a stale copy behind.
- **The page must not scroll sideways at 390px.** `smoke.mjs` asserts it and
  names the offending element. A gallery grid broke this once, by letting an
  aspect ratio derive a tile's width from its row height.
- **Body text floors at 17px** and body copy is deep navy on cream, around 13:1.
  The soft slate blue is for borders, icons and large text only — it does not
  have the contrast to carry small text, and the people reading this are often
  making a decision about a parent while in their sixties themselves.
- **The wizard's advance button is deliberately `type="button"`.** React
  reconciles the "Continue" and "Request my tour" states onto one DOM node and
  flushes the click's state update before the browser evaluates the default
  action — so a node that becomes `type="submit"` submits the form on the very
  click that advanced the step, skipping the visitor straight to the thank-you
  screen. There is a comment at the call site; please leave it there.
