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

Everything except the daily reminder runs in Expo Go. Expo Go's support for
expo-notifications varies by platform and SDK, so if the reminder toggle does
not work there, use a development build (`npx expo run:android` /
`npx expo run:ios`, or `eas build --profile development`). The reminder is
hidden on the web build.

## Checks

```bash
npm run typecheck
npm test                 # 54 tests: logic, storage, and the whole screen
npx expo export --platform android --platform ios --platform web --output-dir dist
```

CI (`.github/workflows/personal-daily-hub.yml`) runs all three, path-filtered
to this folder.

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

- `ios.bundleIdentifier` and `android.package` are not set in `app.json`;
  EAS will ask for them.
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
