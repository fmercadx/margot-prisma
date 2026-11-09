# Car Mirror privacy policy

Effective November 7, 2026 (touch control and the driving pause added the same day).

Car Mirror shows your Android phone's screen in your car's web browser. This policy covers
the Car Mirror app.

## What the app collects

Nothing. Car Mirror has no account, no analytics, no ads, no crash reporting, and no
server of its own. It does not collect, store, sell or share personal data.

## What happens to your screen

While you have mirroring turned on, the app captures your screen, compresses it, and sends
it directly to the browser of the device that opened the app's address over your phone's
hotspot, normally your car. The images are held in memory only long enough to send them,
and are never saved to storage or sent to anyone else.

Only devices connected to your phone's hotspot can open that address, and the app refuses
requests that don't use one of the addresses it shows you. In test mode, which happens
only if the VPN is declined or can't start, devices on the same Wi-Fi network as your
phone can open it too; the app says so on screen when that applies.

## The VPN

Car Mirror uses Android's VPN feature for one purpose: to give your phone an extra network
address that your car's browser will open. The VPN applies only to Car Mirror itself and
routes only that one address. It does not carry, inspect or change any other app's
traffic, and it sends nothing anywhere.

## The address your car looks up

The address the app shows, such as `169-254-73-1.sslip.io`, is looked up by your car's
browser through public DNS, like any web address. That lookup reveals only the address
itself, which is the same for every user. The app does not contact sslip.io or any other
service.

## Touch control (optional)

If you turn on touch control, Car Mirror uses Android's Accessibility permission to perform
the taps and swipes you make on your car's screen. That is all it does with it: it is set up
so it cannot read what is on your screen or what you type, and it receives no information
about other apps. Taps are performed on your phone and not recorded. It is off until you
turn it on in Android's settings, and you can turn it off there any time.

## Pause while the car is moving (optional)

If you turn this on, Car Mirror reads your phone's GPS speed while mirroring, only to decide
whether the car is moving. Location is used on your phone and is never stored, logged or
sent anywhere. When mirroring stops, so does the GPS.

## Permissions

| Permission | Why |
| --- | --- |
| Screen capture | To mirror your screen. Android asks you each time you start. |
| VPN | To add the address your car can open, as described above. |
| Notifications | To show that mirroring is on, with Pause and Stop buttons. |
| Network access | So your car can connect to the app. |
| Keep screen on | A screen that turns off has nothing to mirror. |
| Accessibility (optional) | Touch control, as described above. |
| Location (optional) | Pause while the car is moving, as described above. |
| Modify system settings (optional) | Dim this phone while mirroring: it changes screen brightness only, and puts yours back when mirroring stops. |

## Children

Car Mirror is not directed at children and collects no data from anyone.

## Changes and contact

Changes to this policy will be published at this address with a new effective date.
Questions: open an issue at <https://github.com/fmercadx/margot-prisma/issues>.
