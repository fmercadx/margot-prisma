# Play Console: suggested answers

Google asks these in Play Console → Policy and programs → App content. The answers below are
accurate for the app as it stands; reread them if the app changes. Google words its forms
differently from time to time, so match the meaning rather than the exact wording.

## Privacy policy

URL of `PRIVACY.md` (see `listing.md`).

## App access

Choose **All or some functionality is restricted** and add these instructions, because a
reviewer won't have a car:

> No account or login. To test without a car: turn on the phone's Wi-Fi hotspot, connect a
> laptop or a second phone to it, open Car Mirror and tap Start mirroring, and allow the
> prompts. Then open the address the app shows (for example 169-254-73-1.sslip.io:8080, or
> the next one listed if that doesn't load) in the laptop's web browser. The phone's screen
> appears there. Touch control is optional: tap "Turn on touch control" to try tapping on
> the laptop's picture.

## Advertising ID

Does the app use an advertising ID? **No.**

## Data safety

- Does the app collect or share any of the required user data types? **No.**
- Is all user data encrypted in transit? Not applicable: nothing is collected or sent to the
  developer. (The picture goes from the phone to the car over the phone's own hotspot.)
- Location, used only by the driving pause (on by default, can be switched off), is
  processed on the device and never leaves it. Google's definitions don't count on-device-only processing as "collected".

## Ads

Contains ads: **No.**

## Content rating questionnaire

Category: **Utility, Productivity, Communication or Other.** Answer No to violence, sexual
content, language, controlled substances, gambling and user-to-user interaction. The app does
not share the user's location with other users. Expected rating: Everyone / PEGI 3.

## Target audience

**18 and over** (it is for drivers). Not designed for children.

## VPN declaration

- Is providing a VPN the app's core functionality? **No.**
- Which permitted use applies? Pick the closest **network-related tool** option.
- Description to paste:

> Car Mirror shows the phone's screen in the car's web browser over the phone's hotspot.
> Car browsers refuse the private addresses a hotspot uses, so the app uses VpnService only
> to add one extra link-local address (169.254.73.1) to the phone, which the car's browser can
> open. The VPN applies only to Car Mirror itself (addAllowedApplication), routes only that
> single /32 address, is bypassable, and carries, inspects or redirects no traffic from any
> app. No data is sent to any server. The app explains this to the user in its own dialog
> before Android's VPN consent prompt.

## Foreground service types

**Media projection**

- Use case: Media projection (streaming the screen to another display).
- Description: "Sends the phone's screen to the car's browser while the user has mirroring
  on. Started only when the user taps Start mirroring and accepts Android's screen-sharing
  prompt; a notification with Pause and Stop is shown throughout."
- Video: record the phone tapping Start mirroring, accepting the prompt, and the picture
  appearing in a browser on the same hotspot (a laptop works for the recording).

**Location** (only declared because of the driving pause)

- Use case: the closest navigation or location-tracking option for an in-car feature.
- Description: "'Pause while driving' safety setting, on by default and can be switched off.
  While mirroring, the app reads GPS speed to blank the car's picture when the car is moving.
  The first start explains this in the app before Android's location prompt; declining
  switches the setting off. Location is used on the device only, never stored or
  transmitted, and only while mirroring is on."
- Video: tapping Start mirroring, the app's explanation, granting location, and the
  notification showing the picture paused while moving.

## Location permission

Foreground location only (no background location permission). Same description as above.

## Accessibility API

Car Mirror is **not** an accessibility tool (`isAccessibilityTool="false"`), so Google needs
a declaration and an in-app disclosure, which the app shows before sending the user to
Settings.

- Description to paste:

> Optional touch control: lets the user tap, swipe and long-press on the car's screen to
> control the phone while mirroring. The service only performs those gestures with
> dispatchGesture. It is configured with canRetrieveWindowContent="false" and receives no
> accessibility events, so it cannot read screen content or typed text. Nothing is collected
> or transmitted. It is off until the user turns it on in Accessibility settings, after the
> app's own explanation.

- Video: tapping Turn on touch control, the app's explanation, enabling it in Settings, and a
  tap on the car's (or a laptop browser's) picture operating the phone.

## Modify system settings (WRITE_SETTINGS)

Used only by the optional "Dim this phone while mirroring" to set screen brightness, restored
when mirroring stops. No declaration form exists for it at the time of writing; mention it in
the description if asked.

## News app, health, financial features, government

No to all.
