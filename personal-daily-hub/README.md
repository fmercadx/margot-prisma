# Personal Daily Hub

A one-screen, dark-mode daily dashboard built with React Native and Expo
(SDK 58). Everything stays on the device.

| Module | What it does |
| --- | --- |
| Header | Day, date and time, kept current to the minute; greeting; daily-reminder toggle |
| Quick Capture | Timestamped notes in a list that scrolls inside its card |
| Habits | Four core habits with cross-out on completion; custom habits (Premium) |
| Water & Energy | Glass-by-glass progress bar; 1–10 energy slider |
| Expenses | Amount + optional label, running total for the day |
| Last 7 days | Water, energy and spending charts (Premium) |

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
scan the QR code. Everything works, including the 8 PM reminder: Expo Go on
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
- No storage permissions: the template's `READ`/`WRITE_EXTERNAL_STORAGE`
  are blocked, since the app never touches files.
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
to this folder. The suite covers logic, storage, the whole rendered screen,
and platform branches such as Android's notification channel.

## How data is stored

State is keyed by **local** date string, so each morning starts empty while
earlier days stay saved:

```ts
{
  habits: [{ id, label, core }],                 // definitions carry across days
  days: {
    '2026-11-08': { notes, habitsDone, water, energy, expenses },
  },
}
```

On disk (AsyncStorage) every day has its own key, `pdh:v1:day:YYYY-MM-DD`,
plus `pdh:v1:habits` for custom habits. One key per day keeps each write
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

## Premium (mock)

`isPremium` starts `false` on every launch. Free users get three Quick
Capture notes per day; the fourth opens a bottom-sheet paywall listing
the three benefits — unlimited entries, historical graphs, custom habits —
with an **Unlock Premium for $4.99** button. Custom habits and the 7-day
charts are gated too, since the paywall advertises them.

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
- The icon and splash images in `assets/` are Expo's template placeholders.

## Layout

```
App.tsx                     providers + status bar
src/screens/HomeScreen.tsx  composes the modules, owns isPremium and the paywall
src/components/             one file per module, plus Card, IconButton, StepSlider
src/hooks/useDailyHub.ts    reducer + load/save
src/hooks/useClock.ts       minute clock and today's date key
src/lib/store.ts            state shape and reducer (pure)
src/lib/storage.ts          AsyncStorage keys, validation, debounced writer
src/lib/reminders.ts        8 PM local reminder (reminders.web.ts stubs it)
src/lib/premium.ts          free limits, paywall copy, the mock purchase
src/icons.ts                every Lucide icon used, imported per file
src/theme.ts                colours, spacing, type
```

`src/icons.ts` imports each icon from its own file because Metro does not
tree-shake: importing from the `lucide-react-native` root put all ~1,600
icons in the bundle (3.2 MB web bundle vs. ~570 KB now).
