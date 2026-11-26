# The car page's crypto

`viewer.html` runs over plain http, where browsers withhold `crypto.subtle`, so the pairing
and session crypto (X25519, SHA-256, HMAC, HKDF, ChaCha20-Poly1305) comes from the audited
[noble](https://paulmillr.com/noble/) libraries instead. This folder bundles just the
functions `viewer.html` needs into one file, which is committed and served by the phone:

    core/src/main/resources/io/github/fmercadx/carmirror/core/crypto.js

To rebuild it (only needed when changing `entry.mjs` or the pinned versions):

    cd car-mirror/tools/crypto && npm ci && npm run build

Versions are pinned exactly in `package.json` and `package-lock.json`. The phone's side is
`core/.../Crypto.kt` (BouncyCastle); `PairingTest` checks the two agree byte for byte using
values computed with this file.
