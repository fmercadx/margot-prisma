// Encryption at rest for everything the app stores.
//
// AES-256-GCM, from expo-crypto (Android's javax.crypto, Apple's CryptoKit).
// The key is generated on first launch and kept in expo-secure-store, which
// wraps it with the Android Keystore / iOS Keychain. It is marked
// THIS_DEVICE_ONLY, so it never leaves the phone in a backup or iCloud sync,
// and Android backups are switched off as well (app.json).
//
// Each value is sealed with a fresh random 96-bit nonce, and the storage key
// it is filed under ("pdh:v1:day:2026-11-08") is bound in as additional
// authenticated data. Someone with access to the database could therefore
// not swap one day's record for another's without decryption failing.
//
// Stored form:  "pdh1:" + base64(nonce ‖ ciphertext ‖ 16-byte tag)

import { AESEncryptionKey, AESKeySize, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import { isSealed, SEALED_PREFIX, type Codec } from './codec';
import { utf8Decode, utf8Encode } from './utf8';

const KEY_NAME = 'pdh.dataKey.v1';
const KEY_OPTIONS: SecureStore.SecureStoreOptions = {
  // Readable once the phone has been unlocked after boot; never synced.
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

/**
 * Loads the data key, creating it on first launch.
 *
 * A key is only ever created when none is stored. If reading the key fails
 * (the Keystore can be briefly unavailable, or reset by an OS update), this
 * throws instead of minting a new one, and the caller switches saving off:
 * writing with a fresh key would orphan everything sealed with the old one.
 */
async function loadOrCreateKey(): Promise<AESEncryptionKey> {
  const stored = await SecureStore.getItemAsync(KEY_NAME, KEY_OPTIONS);
  if (stored) return AESEncryptionKey.import(stored, 'base64');

  const key = await AESEncryptionKey.generate(AESKeySize.AES256);
  // Saved before it is ever used: data is never sealed with a key that
  // might not survive the next launch.
  await SecureStore.setItemAsync(KEY_NAME, await key.encoded('base64'), KEY_OPTIONS);
  return key;
}

export async function createDataCodec(): Promise<Codec> {
  const key = await loadOrCreateKey();
  return {
    encrypted: true,

    async seal(storageKey, json) {
      const sealed = await aesEncryptAsync(utf8Encode(json), key, {
        nonce: { length: 12 },
        additionalData: utf8Encode(storageKey),
      });
      return SEALED_PREFIX + (await sealed.combined('base64'));
    },

    async open(storageKey, stored) {
      // Plain JSON written by version 1.0, before encryption. Readable once;
      // ensureSealed() re-writes it encrypted at launch.
      if (!isSealed(stored)) return stored;
      const sealed = AESSealedData.fromCombined(stored.slice(SEALED_PREFIX.length));
      const bytes = await aesDecryptAsync(sealed, key, {
        output: 'bytes',
        additionalData: utf8Encode(storageKey),
      });
      return utf8Decode(bytes);
    },
  };
}
