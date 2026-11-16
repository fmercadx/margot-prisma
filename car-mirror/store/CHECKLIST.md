# Selling Car Mirror: step by step

Everything a store asks you to upload or paste is in this kit. The steps below are the ones
only you can do: accounts, payments, testers and a few short recordings.

| In the kit | Use it for |
| --- | --- |
| `screenshots/listing-1-car.png` … `listing-5-settings.png` | Phone screenshots, in that order |
| `graphics/icon-512.png` | App icon (512 × 512) |
| `graphics/feature-graphic.png` | Feature graphic (1024 × 500), Google Play only |
| `text/app-name.txt`, `short-description.txt`, `full-description.txt` | The listing's text boxes |
| `text/privacy-policy-url.txt` | Privacy policy URL |
| `play-console-answers.md` | Every App content form in Play Console |

## Before either store

1. **Pick a price.** $2.99 to $4.99 is typical for a utility like this. Choose *paid* when you
   create the app: a free app can never be changed to paid.
2. **Pick a contact email** you're happy to have shown publicly on the listing.
3. **The private signing key.** Both stores need the app signed with a key only you hold, not
   the shared one the test builds use. Create it once (README, "Selling on Google Play") and
   add it to the repository's secrets; from then on every build also produces the Play bundle
   (`.aab`) and a privately signed APK for the Galaxy Store, as a download on the build's
   run page (`car-mirror-store-builds`).

## Google Play

1. **Developer account** at play.google.com/console: $25 once, plus ID verification. A
   personal account is fine. An organization account needs a D-U-N-S number but skips step 6.
2. **Payments profile** (Play Console → Settings → Payments profile), so you can sell.
3. **Create app.** Name: paste `app-name.txt`. Language: English (United States). App, *Paid*.
4. **Main store listing.** Paste the three text files, upload the icon, the feature graphic and
   the five screenshots. Category: Auto & Vehicles. Add your contact email.
5. **App content.** Work down the list with `play-console-answers.md`. Three declarations need a
   short screen recording; record each on your phone with its built-in screen recorder, using
   a laptop or second phone on your hotspot as "the car":
   - *Foreground service: media projection.* Tap Start mirroring, allow screen sharing, then
     show the picture appearing in the laptop's browser.
   - *Foreground service: location.* Start mirroring, show the "Pause while driving"
     explanation and allow location.
   - *Accessibility (touch control).* Tap Turn on touch control, show the app's explanation,
     switch it on in Settings, then tap on the laptop's picture and show the phone responding.

   Upload each to YouTube as *Unlisted* and paste the link.
6. **Closed test** (personal accounts only): Testing → Closed testing → create a track, upload
   the `.aab`, and add at least 12 testers by email. Each opens the opt-in link, installs the
   app and keeps it for 14 days in a row. Friends, family and Android-owning Tesla drivers you
   know all count; they don't need a Tesla to stay opted in.
7. **Production.** After the 14 days, apply for production access, set the price and
   countries, and send the release for review. Reviews usually take a few days.

## Samsung Galaxy Store

1. **Seller account** at seller.samsungapps.com: free. For a paid app, Samsung asks you to
   become a commercial seller, with bank and tax details.
2. **Add New App → Android.** Upload the privately signed APK (`car-mirror-N-galaxy.apk`).
3. **Listing.** The same text, icon and screenshots. Samsung shows its exact size rules on the
   upload page; if it refuses the landscape `listing-1-car.png`, leave that one out.
4. **Age rating, price and countries**, then submit for review.

## If a review pushes back

- **VPN.** The most likely objection. Reply with the VPN text from `play-console-answers.md`.
  If it's still refused, the app can work without the VPN where a car accepts the hotspot's
  own address.
- **Accessibility.** Touch control can be left out of the store build and added in an update.
- **The word "Tesla".** The listing names Tesla only to say what the app works with, and says
  Car Mirror isn't affiliated. If a reviewer objects to it appearing in the screenshots, the
  app's wording can say "your car" instead and the screenshots be regenerated.
