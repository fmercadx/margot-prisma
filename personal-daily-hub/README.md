# Personal Daily Hub

A one-screen, dark-mode daily dashboard built with React Native and Expo
(SDK 58). Everything stays on the device.

| Module | What it does |
| --- | --- |
| Header | Day, date and time, kept current to the minute; greeting; daily-reminder toggle; Settings |
| Today's focus | One line for the thing that matters most today; tap to change or clear it |
| Quick Capture | Timestamped notes and to-dos in a list that scrolls inside its card; tap to edit, tick a to-do off; unfinished to-dos from the past week can be brought over to today; search every note, focus and expense label from any day |
| Habits | Four core habits with cross-out on completion and day streaks, with a word of congratulations at 3, 7, 14, 30 and 60 days; custom habits (Premium) |
| Wellbeing | Glass-by-glass progress bar toward your water goal; last night's sleep in half hours; 1–10 energy slider; five-face mood check-in |
| Expenses | Amount, optional label and a category (food, transport, shopping, bills, fun, other); running total, what's left of an optional daily budget, and where the money went |
| History | Weekly summary (water, sleep, energy, mood, habits done, spending, where most went), water / sleep / energy / mood / spending charts, a month calendar shaded by habits done with the month's totals and where its money went, and every past day in full (Premium) |
| Settings | Water goal, reminder time, daily budget, haptic feedback, app lock and how soon it locks again, export and restore your data, erase everything |

Deleting a note, an expense or a custom habit shows **Undo** for five
seconds.

## Security and privacy

What protects what, and why each is there:

| Layer | What it does | Where |
| --- | --- | --- |
| Encryption at rest | Every stored value is AES-256-GCM ciphertext. The key is made on first launch and held by the Android Keystore / iOS Keychain (`THIS_DEVICE_ONLY`), never in the database beside the data. | `src/lib/dataCodec.ts` |
| Tamper and swap detection | Each value's storage key (e.g. `pdh:v1:day:2026-11-08`) is bound in as authenticated data, so editing a byte or moving one day's record onto another fails to decrypt. | `dataCodec.ts` |
| App lock (optional) | Fingerprint, face or phone PIN at launch and after time in the background: 30 s by default, or at once, 1 min or 5 min. While on, Android shows a blank preview in recent apps and blocks screenshots (FLAG_SECURE); iOS blurs the app switcher. | `src/lib/appLock.ts`, `src/hooks/useAppLock.ts` |
| No network | The release APK has **no INTERNET permission**, so Android itself refuses any connection. The app makes none anyway. | `app.config.js` |
| No cloud backup | `allowBackup` is off, so the data never lands in a Google backup. Export is the explicit way to take a copy. | `app.json` |
| Fewest permissions | Push, launcher-badge, storage and photo (`READ_MEDIA_IMAGES`) permissions are stripped; CI fails if one comes back. | `app.json`, APK workflow |
| Erase everything | Settings → Erase all data, after a confirmation (and the owner's fingerprint, face or PIN when app lock is on). Every stored value is removed, quarantined copies included, and then the encryption key is deleted from the Keystore / Keychain, so a copy of the database taken earlier can't be decrypted. A new key is made for whatever comes next. The daily reminder is cancelled and old export files are deleted too. | `erase` in `src/hooks/useDailyHub.ts` |
| Restore treats the file as hostile | A picked backup is size-capped (5 MB), must name this app and a format it knows, and passes the same sanitizers as stored data, with length caps on every string, per-day caps on notes and expenses, real non-future dates only, and at most ten years. Restoring only adds: nothing on the phone is overwritten, and the picker's plain-JSON copy is deleted from the cache once read. | `src/lib/importJson.ts`, `mergeBackup` in `store.ts` |

Limits worth knowing:

- The lock keeps people out of the app on an unlocked phone; it does not
  add to the encryption. The key opens without a fingerprint, so a lock
  change or a new fingerprint can never make the data unreadable.
- "Lock again after: at once" also locks after the share sheet or the file
  chooser, which briefly send the app to the background. The default 30 s
  grace period exists so export and restore don't ask twice.
- Restore merges rather than replaces. Where the backup and the phone
  both have a value, the phone's wins; notes and expenses are combined by
  id; water takes the larger count. Restoring the same file twice adds
  nothing the second time. The preview says exactly what will be added
  before anything is written.
- An exported file is plain JSON, by design (it is your copy, to open
  anywhere). Settings says so. Export files are written to the app's private
  cache and removed at the next launch.
- The web demo has no secure key store, so it keeps plain JSON in the
  browser. Its Settings says "Stored only on this device" rather than
  "encrypted".
- Development builds (Expo Go, `expo run`) keep the INTERNET permission,
  because Metro serves the JavaScript over the network. Only the release
  build drops it (`PDH_RELEASE_OFFLINE=1`, set by the APK workflow).

Erasing goes in a fixed order. Writes still queued are dropped, and a
write already under way is waited out, so nothing sealed with the old key
can land afterwards. Then the data is removed, and only then the key: had
deleting the key failed, no data would be left for it to open. If any step
fails, saving is switched off for the session rather than continuing with a
key that may be gone.

Search runs on the phone: it decrypts the stored days, looks through them in
memory, and keeps nothing afterwards.

If the key is ever lost (secure storage reset), values that will not
decrypt are copied to `pdh:v1:corrupt:*` keys, not deleted, and the app
starts those days fresh. A key read that merely fails switches saving off
for the session instead of minting a new key over the old data.

## Running it

```bash
cd personal-daily-hub
npm ci
npx expo start          # then scan the QR code with Expo Go, or press i / a / w
```

The reminder is hidden on the web build.

## On an Android phone

**Install the APK — no computer needed.** Every push that touches this
folder runs `.github/workflows/personal-daily-hub-android.yml`, which builds
a release APK. Open the run under the repo's **Actions** tab, download the
**personal-daily-hub-apk** artifact, unzip it, and open `app-release.apk` on
the phone (allow "install unknown apps" for your browser or Files app when
asked). The run's summary shows the package name and SHA-256.

That APK is signed with the template's debug key: fine for testing, not
accepted by the Play Store. For Play, build with EAS, which manages a real
upload key: `npx eas-cli build -p android`.

**Or live-reload with Expo Go.** Install Expo Go from the Play Store (it must
support SDK 58), run `npx expo start` on a computer on the same Wi-Fi, and
scan the QR code. Everything works, including the daily reminder: Expo Go on
Android only lacks *push* notifications, which this app does not use. It
does log two expo-notifications warnings saying so; they are harmless.

Android specifics already handled:

- Package `com.fmercadx.personaldailyhub` (`app.json`). It becomes
  permanent the first time it is uploaded to Play, so change it before then
  if you want a different one.
- Dark splash screen and dark system UI (`expo-splash-screen`,
  `expo-system-ui`), so there is no white flash at launch.
- A white-on-transparent notification icon
  (`assets/notification-icon.png`); Android renders a full-colour icon as
  a blank square in the status bar.
- The notification channel is created before asking permission — Android
  13+ shows no prompt for an app without one. The reminder survives a
  reboot (expo-notifications re-arms it).
- Only the permissions the app uses. `android.blockedPermissions` in
  `app.json` strips what the template and libraries add but the app never
  needs: storage (it touches no files), Firebase push
  (`c2dm.permission.RECEIVE`; the reminder is local), and 16 launcher-badge
  permissions from expo-notifications' badge library (the app never sets a
  badge). The APK build reads that list and fails if any of them reappears
  after a library update, or if the reminder's `POST_NOTIFICATIONS` /
  `RECEIVE_BOOT_COMPLETED` go missing. `WAKE_LOCK` and
  `ACCESS_NETWORK_STATE` stay: Firebase and Play-services code still in the
  APK may use them, and removing a permission that code calls for crashes
  it. Neither prompts the user. The same goes for `DETECT_SCREEN_CAPTURE`:
  expo-screen-capture registers a screenshot callback the moment it loads on
  Android 14+, which crashes without it, so CI requires it to be present.
  Its `READ_MEDIA_IMAGES` (Android 13's screenshot listener, which this app
  never starts) is blocked; that code only checks the permission when a
  screenshot happens and logs if it is missing.
- Edge-to-edge: content is padded by the system-bar insets, and the
  keyboard is handled by a `KeyboardAvoidingView` (Android only; iOS uses
  the ScrollView's own keyboard insets).
- Text fields drop Android's default underline and use the app's cursor and
  selection colours. The back gesture closes the paywall.

## Checks

```bash
npm run typecheck
npm test                 # runs every test twice: as iOS, then as Android
npx expo export --platform android --platform ios --platform web --output-dir dist
```

CI (`.github/workflows/personal-daily-hub.yml`) runs all three, path-filtered
to this folder. The suite covers logic, encryption (real AES-GCM, via Node's
crypto standing in for the native module), storage and migration, the whole
rendered screen, the app lock, export, and platform branches such as
Android's notification channel.

The APK workflow then runs the release APK on an **Android emulator**
(`scripts/android_smoke.py`): it launches the app, adds a note, kills and
restarts it, checks the note survived, reads the app's database as root to
confirm it holds only ciphertext, confirms the app has no INTERNET
permission, and checks logcat for crashes. Screenshots from the emulator are
in the run's **personal-daily-hub-emulator** artifact.

## How data is stored

State is keyed by **local** date string, so each morning starts empty while
earlier days stay saved:

```ts
{
  habits: [{ id, label, core }],                 // definitions carry across days
  days: {
    '2026-11-08': { focus, notes, habitsDone, water, sleep, energy, mood, expenses },
  },
}
```

On disk (AsyncStorage) every day has its own key, `pdh:v1:day:YYYY-MM-DD`,
plus `pdh:v1:habits` for custom habits and `pdh:v1:settings`. Each value is
stored sealed: `pdh1:` + base64(nonce ‖ ciphertext ‖ tag). Data saved by
version 1.0 as plain JSON is encrypted in place at the first launch of 1.1. One key per day keeps each write
small, means a corrupt value costs one day rather than the whole history,
and stays far below Android's per-value size limit.

What keeps it safe (`src/hooks/useDailyHub.ts`, `src/lib/storage.ts`):

- Nothing is written until the first load finishes, so an empty initial
  state can never overwrite saved data. If that load fails, writing stays
  off for the session and the screen says so.
- Only days that actually changed are written, debounced to one `multiSet`
  per burst (a slider drag is one write, not ten), and writes are chained so
  an older value never lands after a newer one.
- Pending writes are flushed when the app is backgrounded.
- Every value read back is validated field by field. A value that is not
  valid JSON is copied to a `pdh:v1:corrupt:*` key before it is replaced.
- Dates use local time, never `toISOString()` (which is UTC and would file
  an evening's entries under tomorrow in the Americas). Money is integer
  cents, so the running total cannot drift.
- If the app is left open past midnight it rolls over to the new day.
- Sixty days are kept in memory: seven for the charts, the rest for habit
  streaks and the month calendar. Export and search read everything else
  from storage.
- Fields added later read back with a default when older data lacks them:
  an expense saved before 1.3 is filed under "other", a day has no focus
  or sleep, and a note is a plain note rather than a to-do. Older backups
  restore the same way.
- A to-do brought over to today is a copy with a new id; the original stays
  on its day, marked as brought over, so it is offered only once and the
  earlier day still shows what was planned.

## Premium (mock)

`isPremium` starts `false` on every launch. Free users get three Quick
Capture notes per day; the fourth opens a bottom-sheet paywall listing
the three benefits — unlimited entries, historical graphs, custom habits —
with an **Unlock Premium for $4.99** button. Custom habits and History
(charts, summary, month calendar, past days) are gated too, since the
paywall advertises them. Search, to-dos, sleep, categories, the budget and
the focus line are free. To-dos brought over to today count toward the three
free entries, like any other.

The paywall is dismissible ("Not now", the backdrop, Android back) and keeps
whatever was being typed; unlocking finishes the blocked action (the fourth
note is saved, the habit composer opens).

**The purchase is a mock.** `purchasePremiumMock()` in `src/lib/premium.ts`
waits 600 ms and returns `true`; no store is contacted and no money moves.
Before release, replace that one function:

- Apple and Google require digital unlocks inside an app to use their own
  in-app purchase systems (StoreKit / Play Billing, or a wrapper such as
  RevenueCat). A custom checkout would be rejected in review.
- Restore the entitlement from the store at launch, where `isPremium` is
  initialised in `HomeScreen.tsx`. Do not persist a local `isPremium` flag
  as the source of truth; anyone could flip it.
- Decide whether $4.99 is a one-time unlock or a subscription. The copy
  currently says neither.

## Before shipping

- `ios.bundleIdentifier` is not set in `app.json`; EAS will ask for it.
- Bump `android.versionCode` for every release you hand out; Android only
  installs an update over an older code.
- The icon and splash images in `assets/` are Expo's template placeholders.

## Layout

```
App.tsx                     providers + status bar
src/screens/HomeScreen.tsx  composes the modules; owns premium, undo, settings
src/components/             one file per module, plus Card, IconButton, StepSlider,
                            SettingsSheet, LockScreen, Toast, PaywallModal, DaySheet,
                            TodayFocus, SearchSheet, MonthCalendar
src/hooks/useDailyHub.ts    reducer + key, migration, load/save
src/hooks/useAppLock.ts     when the lock screen shows
src/hooks/useClock.ts       minute clock and today's date key
src/lib/store.ts            state shape, reducer, streaks (pure)
src/lib/storage.ts          AsyncStorage keys, validation, debounced encrypted writer
src/lib/dataCodec.ts        AES-256-GCM with a Keystore/Keychain key (.web.ts: plain)
src/lib/appLock.ts          biometric prompt, screen-capture protection (.web.ts: off)
src/lib/exportData.ts       export via the share sheet (.web.ts: download)
src/lib/exportJson.ts       the export file's contents (pure)
src/lib/importJson.ts       reading a backup back in, as untrusted input (pure)
src/lib/importData.ts       the system file chooser (.web.ts: the browser's)
src/lib/summary.ts          the week at a glance (pure)
src/lib/categories.ts       expense categories and budget steps (pure)
src/components/CategoryBars.tsx  "where it went" bars, for a day and a month
src/lib/search.ts           accent- and case-insensitive search with match positions (pure)
src/lib/haptics.ts          feedback taps, switchable, silent on web
src/lib/mood.ts             the five mood words
src/lib/reminders.ts        daily local reminder (reminders.web.ts stubs it)
src/lib/premium.ts          free limits, paywall copy, the mock purchase
src/lib/utf8.ts             UTF-8 for the cipher, independent of Hermes
scripts/android_smoke.py    the emulator test CI runs against the APK
app.config.js               drops INTERNET from the release build
src/icons.ts                every Lucide icon used, imported per file
src/theme.ts                colours, spacing, type
```

`src/icons.ts` imports each icon from its own file because Metro does not
tree-shake: importing from the `lucide-react-native` root put all ~1,600
icons in the bundle (3.2 MB web bundle vs. ~670 KB now).

Expense categories are told apart by icon and name, not by colour: six hues
side by side cannot all be distinguished by colour-blind readers. So "Where
it went" is a list of single-colour bars, each row labelled, rather than a
stacked bar in six colours. The calendar uses one hue, stepping from the
card surface toward full green.
