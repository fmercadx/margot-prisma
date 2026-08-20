# credit-analyzer mobile

iOS and Android builds of the analyzer, wrapping the same WebAssembly engine
the web build uses. Capacitor supplies the native shell; everything above it is
the code already in `../browser/`.

```bash
npm install
npm run build          # assembles www/ (Pyodide + pypdf + the analyzer)
npx cap sync           # copies www/ into the native projects
npm run open:ios       # Xcode      (macOS only)
npm run open:android   # Android Studio
```

`npm run sync` does the build and the copy in one step.

## What is actually shared

`app.js`, `canonical.py`, `parse_mismo.py`, `parse_pdf.py`, `rules.py` and
`report.py` are **byte-identical** between the web page and the app. One file
differs, and the build picks it:

| Build | Shell | Behaviour |
| --- | --- | --- |
| `--target web` | `browser/shell-web.js` | Blob downloads, no gate, nothing retained |
| `--target mobile` | `mobile/shell-native.js` | Files and share sheet, saved reports, licence gate |

Anything host-specific belongs behind that seam. If a change to `app.js` needs
to know whether it is running in the app, it is in the wrong file.

## The gate is the business model

Everything here rests on one fact: **no consumer pays for this.** A borrower who
subscribes to improve their own credit turns this into a credit repair
organization under 15 U.S.C. § 1679a(3), and CROA's advance-fee ban
(§ 1679b(b)) makes a subscription unlawful the moment that happens — you cannot
charge before the service is fully performed.

So the gate runs before the engine loads, cannot be dismissed, and asks three
questions a borrower cannot truthfully answer. The attestation is stored with a
timestamp and the version of the wording that was accepted.

A build with no `licenceEndpoint` configured **refuses to sign anyone in**. That
is deliberate: the alternative failure mode is a build that lets everyone
through, which is the one that costs you the company. `smoke_native.py` asserts
it.

## Billing is not in-app purchase

Subscriptions are sold on the web and the app signs in against them. Apple's
Enterprise Services guideline (3.1.3(e)) and the equivalent practice on Play
allow this for business apps whose accounts are sold to organizations — the
same shape as every B2B app that logs in with a work account.

That keeps the store's 15–30% off a subscription that is not a consumer sale in
the first place.

The service lives in [`../licence/`](../licence/) — a Cloudflare Worker in front
of Stripe. Deploy it, then point the app at it:

```bash
npx wrangler deploy                    # in ../licence, prints your worker URL
npm run set-endpoint -- https://credit-analyzer-licence.<subdomain>.workers.dev
npm run sync
```

`app.config.json` is the only place the endpoint lives, and `build.py` merges
it into `shell.js` at build time so nothing is edited twice. Use the command
rather than editing the file: it adds the `/licence/verify` path and rejects
`http://`, and both of those mistakes surface on a device as an unexplained
"licence check failed" with nothing pointing at the cause.

Until it is set, the config carries a `YOUR-SUBDOMAIN` token and the app
refuses to sign anyone in — saying exactly that, rather than failing later as a
network error on somebody's phone.

A verified subscription keeps working offline for seven days
(`OFFLINE_GRACE_DAYS`), because a loan officer on a plane should not lose the
tool and a cancelled card should not take a week to notice.

## Why this is not a repackaged website

Apple's guideline 4.2 rejects wrapped web pages, and it should. What makes this
an app:

- **Everything is bundled.** Pyodide, the Python standard library, pypdf and the
  analyzer all ship inside the binary. Nothing downloads at runtime, so the app
  works with the radio off — and no code is fetched after review.
- **Real file handling.** Reports are written through `Filesystem` and leave via
  the share sheet. `<a download>` does nothing inside a web view, so the native
  build rewires those buttons; `smoke_native.py` checks that it did.
- **Saved reports.** Past analyses are kept on-device, reopenable and deletable.
  The web page keeps nothing, by design — this is the affordance a phone adds.
- **Document types.** The app registers PDF and XML, so a tri-merge can come
  straight from Mail or Files into the analyzer.

## Where files go

`Directory.Data` on both platforms. On iOS that resolves to the app's Documents
directory, which `UIFileSharingEnabled` surfaces in the Files app; on Android it
is app-private storage that disappears when the app is uninstalled.

Two consequences worth knowing. Saved reports contain consumer data, so the
delete action in the saved-reports list removes the files, not just the row.
And on iOS the Documents directory is included in iCloud backups — if that is
not acceptable for your clients' data, exclude it before you ship.

## Testing

```bash
# From the repo root.
python credit-analyzer/mobile/smoke_native.py       # native shell, stubbed bridge
python credit-analyzer/browser/smoke.py --dist dist/analyzer
```

`smoke_native.py` stubs Capacitor's plugins and records their calls, so it
covers our logic and not Apple's:

- the gate blocks until it passes, and lifts afterwards
- an unchecked attestation does not get through
- an unconfigured build refuses sign-in rather than admitting everyone
- the report reaches `Filesystem.writeFile` and `Share.share`
- the copy never says "browser" or "tab", which reads as a wrapped web page
- deleting a saved report removes the file, not just the list entry

**A real device run is still required before shipping.** Nothing here proves
WebAssembly performs acceptably in WKWebView, that the share sheet looks right,
or that a 13 MB bundle launches fast enough on an old phone. Run it on hardware.

## Before submitting

- Deploy `../licence/`, then `npm run set-endpoint -- <worker URL> --subscribe <url>`.
- Change `appId` in `capacitor.config.json` from the placeholder
  `com.creditanalyzer.app`.
- Icons and splash screens are generated by `make-icons.py` — re-run it after
  editing the mark, and commit the output.
- Register both developer accounts as an **organization**, not an individual —
  Apple needs a D-U-N-S number, which is free but takes a few days, and Play
  imposes a 12-tester/14-day requirement on new personal accounts that
  organization accounts skip.
- Fill the privacy manifest and Play data-safety form. Both are easy here and
  worth getting exactly right: no data collected, nothing transmitted except
  the licence check, no third-party SDKs, no tracking.
- State plainly in the listing that this is a professional tool for mortgage
  originators and not a consumer credit-repair service. The listing is evidence
  of who you sold to.
