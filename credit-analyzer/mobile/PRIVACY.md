# Privacy declarations

Three separate things must agree with each other. Filling one and forgetting
the others is the usual way this goes wrong.

| Where | What | Status |
| --- | --- | --- |
| `ios/App/App/PrivacyInfo.xcprivacy` | Apple's privacy manifest, shipped in the binary | Written |
| App Store Connect → App Privacy | A questionnaire, separate from the manifest | Answers below |
| Play Console → Data safety | A questionnaire | Answers below |

Both stores also require a **published privacy policy URL**. There isn't one
yet — see the last section.

---

## What the app actually does with data

Worth stating plainly, because it is unusual and it is the answer to almost
every question on both forms.

**Consumer credit reports never leave the device.** They are parsed and
analysed by CPython compiled to WebAssembly, running inside the app. There is
no upload, no server-side processing, and no copy anywhere but the phone. That
is the entire product, not a configuration choice.

**Saved reports stay on the device**, in the app's own container, and the
delete action in the saved-reports list removes the files rather than just the
row. Uninstalling removes them on Android; on iOS they live in the app's
Documents directory, which `UIFileSharingEnabled` exposes in Files and which is
included in iCloud backups unless excluded.

**The professional attestation** — NMLS ID and company — is written to
on-device storage and never transmitted.

**One network call exists in the whole app**: the licence check, which sends
the subscriber's email and licence key to our own service and gets back whether
the subscription is active. That subscriber is a mortgage professional. No
borrower ever has an account.

---

## Apple — App Store Connect, "App Privacy"

This is a different form from the manifest and both are required.

**Data used to track you:** none.

**Data linked to you:**

| Category | Type | Purpose | Notes |
| --- | --- | --- | --- |
| Contact Info | Email Address | App Functionality | The subscriber's sign-in |
| Identifiers | User ID | App Functionality | The licence key |

**Data not linked to you:** none.

Everything else on Apple's list is **No** — no financial info, no usage data,
no diagnostics, no identifiers beyond the licence key, no contacts, no location.

The one that looks wrong and is right: **Financial Info → No.** A credit report
is financial information, but Apple's question is what the app *collects*,
meaning transmits off the device and retains. This app does neither.

---

## Google Play — "Data safety"

**Does your app collect or share any of the required user data types?** Yes.

**Data types collected:**

| Category | Type | Collected | Shared | Required | Purpose |
| --- | --- | --- | --- | --- | --- |
| Personal info | Email address | Yes | No | Required | Account management, App functionality |
| Personal info | User IDs | Yes | No | Required | Account management, App functionality |

**Everything else: not collected.** In particular **Financial info → No**, for
the same reason as above, and **Files and docs → No**: the app reads files the
user chooses, but never transmits them.

**Security practices:**

- *Is all user data encrypted in transit?* **Yes** — the licence check is
  HTTPS only. `set-endpoint` refuses an `http://` URL outright, and Android
  blocks cleartext by default.
- *Do you provide a way for users to request data deletion?* **Yes** —
  cancelling the subscription, or a request to the support address, removes the
  subscriber record. Needs a deletion-request URL before submission.
- *Has your app been independently reviewed against a global security
  standard?* **No.** Do not tick this.

**Data deletion:** the only stored record is the subscriber's email, licence
key and Stripe identifiers, held in the licence service's KV store. Deleting it
is removing three keys.

---

## If any of this changes, this file is wrong

The declarations above are honest today because of specific design decisions.
Each of these would invalidate them:

- **Uploading a credit file anywhere**, for OCR, for a better parser, for
  support, for anything. Financial Info becomes Yes on both forms, and the FTC
  Safeguards Rule obligations that this design avoids all attach.
- **Adding analytics or crash reporting.** Almost every SDK collects device
  identifiers and usage data, and most require their own privacy manifest.
- **Adding a consumer signup.** That breaks far more than these forms — see
  the CROA note in `README.md`.
- **Transmitting the attestation** to a server for record-keeping. Defensible,
  but it would add data collection.

---

## Still needed before submission

**A published privacy policy URL.** Both stores require one and neither will
accept a submission without it. It has to be publicly reachable and cannot sit
behind a login.

The cheapest correct option is a page on the existing Pages site, alongside the
analyzer — no new hosting, no new domain. It needs three facts only the
operator can supply: the legal entity name, a contact address for privacy
requests, and the data-deletion route.

**A support URL and a marketing URL**, same requirement, same place.
