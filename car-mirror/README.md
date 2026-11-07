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
2. In the car, open **Controls → Wi-Fi** and join the hotspot.
3. Open **Car Mirror** and tap **Start mirroring**. Allow the VPN, then screen sharing.
   Choose **Entire screen**: a single shared app goes black when you switch apps.
4. In the car's browser, type the address the app shows, for example
   `100-73-0-1.sslip.io:8080`.

When the car reaches the phone, the app shows **Car connected**. Tap the car's screen to
show the frame rate and go full screen.

## How it works

```
 phone                                              car
 ┌────────────────────────────────────┐   hotspot   ┌─────────────────┐
 │ screen → JPEG frames → web server  │◄───────────►│ browser shows   │
 │                 at 100.73.0.1:8080 │    Wi-Fi    │ the frames      │
 └────────────────────────────────────┘             └─────────────────┘
```

- The phone captures its own screen (Android's screen-sharing API), compresses each change
  to a JPEG, and serves it from a small web server inside the app. The car's browser asks
  for the next frame as soon as it has drawn the last one.
- **Why there's a VPN.** Tesla's browser refuses private addresses like `192.168.x.x`, and
  those are the only addresses a phone hotspot hands out. So the app gives the phone a
  second address, `100.73.0.1`, which isn't private. The car can reach it because the
  phone is the car's gateway. Android only allows adding an address like this through a
  VPN. This VPN covers only this app and routes only that one address. Your other apps'
  traffic is untouched and nothing is sent anywhere.
- **Why the odd hostname.** `100-73-0-1.sslip.io` is a public DNS name that always
  resolves to `100.73.0.1`, for browsers that won't open a bare IP address. Looking it up
  needs the hotspot to have internet. After that, the frames go directly from phone to car.
- **Who can watch.** The server listens only on `100.73.0.1`, which only devices on your
  hotspot can reach. It also refuses requests that name any other host, so a web page can't
  point its own domain at your phone and read the screen.

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
- **View only.** You can't control the phone from the car's touchscreen yet.
- **The phone screen must stay on.** The app keeps it on, dimmed. Pressing the power
  button stops the picture.
- **Battery.** Compressing frames is steady work. Keep the phone plugged in.
- **Picture.** Each frame is a JPEG. Choose **Sharp** for maps and text, **Smooth** for
  motion.

## Driving

The car stops video in its own browser while you drive. This app draws still images, so
the car may keep showing it. Use it like a phone on a dash mount: navigation is fine, video
is not. Local laws about screens the driver can see still apply.

## Signing

`app/signing.keystore` is committed (its password is in `app/build.gradle.kts`) so that
each build installs over the last. This repo is public, so anyone can use that key to sign
an APK your phone would accept as an update to this app. **Install Car Mirror only from
this repo's releases page**, never from a file someone sends you.

## Development

Run these from `car-mirror/`. The workflow is `.github/workflows/car-mirror.yml` at the
repo root.

| Path | What |
| --- | --- |
| `core/` | Frame hub, HTTP server, viewer page. Plain Kotlin, no Android, tested on the JVM. |
| `app/` | The Android app: screen capture, the VPN address, the one-screen UI. |
| `tools/viewer-smoke.cjs` | Drives the viewer page in Chromium against a fake phone. |

```bash
# Core tests (any machine with a JDK)
./gradlew -PcoreOnly :core:test

# The viewer page against a moving test pattern, then the browser checks
./gradlew -PcoreOnly :core:demoServer --args="8090" &   # wait for READY
node tools/viewer-smoke.cjs http://127.0.0.1:8090/      # needs `npm i playwright`

# The APK (needs the Android SDK; CI does this on every push)
./gradlew :app:assembleRelease
```
