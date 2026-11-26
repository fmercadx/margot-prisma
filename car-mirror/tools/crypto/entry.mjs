// The viewer page's crypto, bundled into one file the phone serves itself (no CDN: nothing
// leaves the car's browser for anywhere but the phone). The page is plain http, where
// browsers withhold crypto.subtle, so these are pure-JS implementations from the audited
// noble libraries. Only what the pairing and session protocol needs is exposed.
import { x25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';

globalThis.CarCrypto = {
  randomBytes: (n) => randomBytes(n),
  keyPair: () => {
    const secretKey = x25519.utils.randomSecretKey();
    return { secretKey, publicKey: x25519.getPublicKey(secretKey) };
  },
  sharedSecret: (secretKey, publicKey) => x25519.getSharedSecret(secretKey, publicKey),
  sha256: (data) => sha256(data),
  hmac: (key, data) => hmac(sha256, key, data),
  hkdf: (ikm, salt, info, length) => hkdf(sha256, ikm, salt, info, length),
  seal: (key, nonce, aad, plaintext) => chacha20poly1305(key, nonce, aad).encrypt(plaintext),
  open: (key, nonce, aad, ciphertext) => chacha20poly1305(key, nonce, aad).decrypt(ciphertext),
};
