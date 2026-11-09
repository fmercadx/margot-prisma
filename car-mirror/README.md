# Car Mirror

Shows your Android phone's screen in your Tesla's web browser. It needs no extra hardware
and no account, and the picture goes straight from the phone to the car over the phone's
hotspot.

## Install

1. On your phone, open the repo's
   [Car Mirror releases](https://github.com/fmercadx/margot-prisma/releases), open the
   newest **Car Mirror build**, and tap the `.apk`.
2. Android will ask whether your browser may install apps. Allow it for this install.
   Play Protect may warn that it doesn't recognise the app. That's expected: you built it.

Every push that changes `car-mirror/` builds a new release (marked pre-release when it
isn't on `main`). Installing a newer one replaces the old one.

## Use it in the car

1. Turn on the phone's **hotspot**.
2. In the car, open **Controls → Wi-Fi** and join the hotspot, not your home Wi-Fi.
3. Open **Car Mirror** and tap **Start mirroring**. Allow the VPN, then screen sharing.
   Choose **Entire screen**: a single shared app goes black when you switch apps.
4. In the car's browser, type the address the app shows, for example
   `169-254-73-1.sslip.io:8080`. If it doesn't load, try the others the app lists, in order.

When the car reaches the phone, the app shows **Connected to your car** and which address
the car opened. For full screen, tap the Tesla browser's own full-screen button (the two
arrows at the left of its address bar). The **⋯** button in the car screen's top-left
corner shows the frame rate.

Quicker next time: add the **Car Mirror** tile to Quick Settings, or long-press the app
icon and choose **Start mirroring**. Android still asks to share the screen each time; no
app can skip that.

## Features

- **Touch control.** Tap, swipe and long-press on the car's screen to control the phone.
  Turn it on from the app (it opens Android's Accessibility settings). It only performs
  taps: it is set up so it can't read the screen or what you type.
- **Pause.** **Pause** in the app or the notification blanks the car's screen until you
  tap **Resume**. Useful before opening messages or banking. Taps from the car are ignored
  while paused.
- **Pause while moving** (off by default). Uses GPS speed to blank the picture while the
  car moves, and brings it back about 5 seconds after you stop. It also pauses maps, which
  is why it's off by default.
- **Auto quality.** When the Wi-Fi can't keep up, the picture gets a little softer instead
  of stuttering, then sharpens again. The picture setting you choose is the upper limit.
- **Videos fill the screen.** A video played full screen on a phone has black bars around
  it (a phone is longer than a video). The car's page trims bars that are symmetrical and
  hold still for a few seconds, so the video fills the car's screen, and shows the whole
  picture again the moment anything appears in them. Taps still land in the right place.
- **Remembers what works.** Once the car connects, the app notes which kind of address it
  used and from then on shows only that one (the rest stay under "Page won't load?").
- **Looks after the battery.** Frames are compressed only while a car is watching, and
  mirroring stops by itself after 10 minutes without the car, putting brightness back and
  letting the phone's screen sleep. The notification says whether the car is connected.
- **Dim this phone** (off by default). Turns the phone's brightness right down while
  mirroring and puts it back afterwards. Covering the screen would black out the car's
  picture too; brightness doesn't affect it. Needs "Modify system settings".

## How it works

```
 phone                                              car
 ┌────────────────────────────────────┐   hotspot   ┌─────────────────┐
 │ screen → JPEG frames → web server  │◄───────────►│ browser shows   │
 │   at 169.254.73.1 or hotspot :8080 │    Wi-Fi    │ the frames      │
 └────────────────────────────────────┘             └─────────────────┘
```

- The phone captures its own screen (Android's screen-sharing API), compresses each change
  to a JPEG, and pushes it to the car's browser over one long-lived connection. (The first
  versions had the car ask for each frame, which cost a round trip over the hotspot per
  frame and capped the picture at 10 to 15 fps; pushed, it keeps up with the phone's 30.)
  When the link can't keep up, frames are skipped rather than queued, so the picture never
  falls behind.
- **Two ways in.** The car can open the phone at the hotspot's own address (like
  `192.168.43.1`), or at `169.254.73.1`, an extra address the app adds. Tesla's browser has
  been reported to refuse private addresses like `192.168.x.x`, which is all a hotspot hands
  out, so the extra address is there in case it does. Which one your car accepts isn't
  documented; the app lists them all, most likely first.
- **Why there's a VPN.** Android only lets an app add an address through a VPN. This VPN
  covers only this app and routes only that one address. Your other apps' traffic is
  untouched and nothing is sent anywhere.
- **Why link-local.** Since Android 13, the system drops packets that arrive from outside a
  VPN addressed to the VPN's own address, unless the address is link-local (`169.254.x.x`).
  The first version used `100.73.0.1`, and Android dropped the car's requests to it, which
  showed in the car as `ERR_CONNECTION_TIMED_OUT`.
- **Why the odd hostname.** `169-254-73-1.sslip.io` is a public DNS name that always
  resolves to `169.254.73.1`, for browsers that won't open a bare IP address. Looking it up
  needs the hotspot to have internet. After that, the frames go directly from phone to car.
- **Who can watch.** The server answers only connections that arrive on the extra address
  or the hotspot's own address, which only devices on your hotspot can reach; a connection
  from, say, a café Wi-Fi network the phone is on is closed unanswered. It also refuses
  requests that name any other host, so a web page can't point its own domain at your phone
  and read the screen.
- **Who can tap.** A tap must carry a token that changes every session and that only the
  car's own Car Mirror page can read. Another web page open in the car can't send taps.

## If the car's page doesn't load

- Try the other addresses listed under the main one, in order.
- Check that the car is on the phone's hotspot, not home Wi-Fi or its own LTE.
- **Car connected** never appearing means the car's browser isn't reaching the phone.
- **Test mode** means the VPN didn't start. Android allows one VPN at a time, so turn off
  any other VPN app and start again.
- If none of the addresses work, Tesla may have changed what its browser accepts again.
  The fallback is HTTPS on a domain you own. That works today but needs a domain and a
  certificate, so it isn't built yet.

## Limits

- **Protected apps show black.** Netflix, Disney+, banking apps and others block screen
  capture, and Android enforces that.
- **No sound** goes through the browser. Pair the phone with the car over Bluetooth.
- **Touch is performed after you lift your finger.** A drag on a map happens as one quick
  swipe when you let go, not while you move. Pinch-to-zoom isn't supported.
- **The phone screen must stay on.** The app keeps it on, dimmed. Pressing the power
  button stops the picture.
- **Battery.** Compressing frames is steady work. Keep the phone plugged in.
- **Picture.** Each frame is a JPEG. Choose **Sharp** for maps and text, **Smooth** for
  motion.

## Driving

The car stops video in its own browser while you drive. This app draws still images, so
the car may keep showing it. Use it like a phone on a dash mount: navigation is fine, video
is not. Local laws about screens the driver can see still apply. **Pause while moving**
(above) enforces this, at the cost of maps.

## Signing

`app/signing.keystore` is committed (its password is in `app/build.gradle.kts`) so that
each build installs over the last. This repo is public, so anyone can use that key to sign
an APK your phone would accept as an update to this app. **Install Car Mirror only from
this repo's releases page**, never from a file someone sends you.

## Selling on Google Play

The store kit is in [`store/`](store/): the listing text ([listing.md](store/listing.md)), the
512 px icon and the feature graphic, and suggested answers for every Play Console form
([play-console-answers.md](store/play-console-answers.md)). Each GitHub release also carries
`store-*.png`, 1080 × 1920 screenshots of the real app.

Already in place:

- Targets Android 16 (API 36), which Play requires of new apps since August 31, 2026.
- The app explains the VPN in its own words before Android's VPN prompt.
- A privacy policy: [PRIVACY.md](PRIVACY.md). Play asks for its URL.
- CI builds the bundle Play takes (`.aab`), signed with a private upload key, once that key
  exists as repo secrets (below). The shared key above is never used for Play.

To create the upload key, run this once on a computer with Java, and keep the file and
password somewhere safe. Losing them means asking Google to reset the key.

```bash
keytool -genkeypair -keystore upload.keystore -storetype PKCS12 -alias upload \
  -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=Car Mirror"
base64 -w0 upload.keystore > upload.keystore.b64   # macOS: base64 -i upload.keystore -o upload.keystore.b64
```

Then in the repo's **Settings → Secrets and variables → Actions**, add
`CAR_MIRROR_UPLOAD_KEYSTORE` (the contents of `upload.keystore.b64`) and
`CAR_MIRROR_UPLOAD_PASSWORD`. The next build attaches `car-mirror-play-bundle` to the
workflow run. Download it from the run's page and upload it in Play Console.

What only you can do in Play Console: open a developer account; run a 12-tester, 14-day
closed test if it is a personal account (organization accounts are exempt); and fill in:

- the **VPN** declaration;
- the **foreground service** declaration: screen capture, and location for the driving
  pause, each with a short demo video;
- the **Accessibility API** declaration for touch control. The app shows its own
  explanation before sending users to Settings, as Play requires;
- **location** permission details (optional feature, used on the phone only);
- the **data safety** form: no data collected or shared.

Accessibility and location get the closest review. If either holds up approval, they can
be left out of the store build without touching the rest.

## Development

Run these from `car-mirror/`. The workflow is `.github/workflows/car-mirror.yml` at the
repo root.

| Path | What |
| --- | --- |
| `core/` | Frame hub, HTTP server, viewer page, gestures, auto quality, the moving/stopped rule. Plain Kotlin, no Android, tested on the JVM. |
| `app/` | The Android app: screen capture, the VPN address, touch, the driving pause, the tile, the one-screen UI. |
| `tools/viewer-smoke.cjs` | Drives the viewer page in Chromium against a fake phone, including touch and pause. |

```bash
# Core tests (any machine with a JDK)
./gradlew -PcoreOnly :core:test

# The viewer page against a fake phone, then the browser checks (needs `npm i playwright`).
# The control folder lets the test pause the fake phone and see the taps it received.
./gradlew -PcoreOnly :core:demoServer --args="8090 --control $PWD/build/smoke" &   # wait for READY
node tools/viewer-smoke.cjs http://127.0.0.1:8090/ --control $PWD/build/smoke

# The APK (needs the Android SDK; CI does this on every push)
./gradlew :app:assembleRelease
```
