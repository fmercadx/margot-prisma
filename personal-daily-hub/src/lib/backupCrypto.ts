// Passphrase-protected backups.
//
// An exported file normally holds plain JSON, so anyone who gets the file
// can read it. With a passphrase, the same JSON is sealed with AES-256-GCM
// under a key derived from the passphrase with scrypt; only the wrapper
// below is readable:
//
//   { app, format: 2, encryption: { kdf, N, r, p, salt, cipher }, data }
//
// - scrypt (@noble/hashes, audited, pure JS) makes each guess at the
//   passphrase cost real memory and time. N = 2^15, r = 8 uses 32 MB.
// - The header (cost settings and salt) is bound in as authenticated data,
//   so editing it makes decryption fail rather than weakening the file.
// - A file's own cost settings are checked against hard limits before any
//   work starts: a crafted file can't make the phone spend minutes, or
//   gigabytes, deriving a key.
// - There is no recovery. A forgotten passphrase means the file can't be
//   opened, which is the point.

import { scryptAsync } from '@noble/hashes/scrypt';
import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync, getRandomBytes } from 'expo-crypto';

import { utf8Decode, utf8Encode } from './utf8';

export const PASSPHRASE_MIN_LENGTH = 8;
/** The cost every new protected backup uses. */
export const BACKUP_KDF = { N: 2 ** 15, r: 8, p: 1 } as const;
/** The most a file may ask for: 128 · N · r bytes is 64 MB at the limit. */
const KDF_LIMITS = { minN: 2 ** 14, maxN: 2 ** 16, maxR: 8, maxP: 2 };
const SALT_BYTES = 16;
/** A protected backup is a little larger than the plain one it holds. */
const DATA_MAX_LENGTH = 8 * 1024 * 1024;

export type SealedBackup = {
  app: 'Personal Daily Hub';
  format: 2;
  encryption: { kdf: 'scrypt'; N: number; r: number; p: number; salt: string; cipher: 'AES-256-GCM' };
  data: string;
};

// ---- base64, without relying on atob/btoa being present ------------------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? B64[n & 63] : '=';
  }
  return out;
}

export function fromBase64(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0) return null;
  const clean = text.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let j = 0;
  for (const ch of clean) {
    value = (value << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[j++] = (value >> bits) & 0xff;
    }
  }
  return out;
}

// ---- sealing and opening -------------------------------------------------

/** The same passphrase typed on different keyboards should give the same key. */
function normalize(passphrase: string): string {
  try {
    return passphrase.normalize('NFKC');
  } catch {
    return passphrase;
  }
}

function header(e: SealedBackup['encryption']): Uint8Array {
  return utf8Encode(`Personal Daily Hub backup|2|${e.kdf}|${e.N}|${e.r}|${e.p}|${e.salt}|${e.cipher}`);
}

async function deriveKey(passphrase: string, salt: Uint8Array, e: { N: number; r: number; p: number }) {
  const bytes = await scryptAsync(utf8Encode(normalize(passphrase)), salt, { N: e.N, r: e.r, p: e.p, dkLen: 32 });
  return AESEncryptionKey.import(bytes);
}

/** Seals a backup's JSON with a passphrase. Returns the file's contents. */
export async function sealBackup(json: string, passphrase: string): Promise<string> {
  if (passphrase.length < PASSPHRASE_MIN_LENGTH) throw new Error('passphrase too short');
  const encryption: SealedBackup['encryption'] = {
    kdf: 'scrypt',
    ...BACKUP_KDF,
    salt: toBase64(getRandomBytes(SALT_BYTES)),
    cipher: 'AES-256-GCM',
  };
  const key = await deriveKey(passphrase, fromBase64(encryption.salt)!, encryption);
  const sealed = await aesEncryptAsync(utf8Encode(json), key, { nonce: { length: 12 }, additionalData: header(encryption) });
  const file: SealedBackup = { app: 'Personal Daily Hub', format: 2, encryption, data: await sealed.combined('base64') };
  return JSON.stringify(file, null, 2);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isPow2 = (n: number) => Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;

/**
 * The file's wrapper if it is a protected backup, else null. Cost settings
 * outside the limits are refused here, before anything is derived.
 */
export function readSealedBackup(text: string): SealedBackup | 'unsupported' | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(raw) || raw.app !== 'Personal Daily Hub' || raw.format !== 2 || !isObj(raw.encryption)) return null;
  const e = raw.encryption;
  const ok =
    e.kdf === 'scrypt' &&
    e.cipher === 'AES-256-GCM' &&
    typeof e.N === 'number' &&
    isPow2(e.N) &&
    e.N >= KDF_LIMITS.minN &&
    e.N <= KDF_LIMITS.maxN &&
    Number.isInteger(e.r) &&
    (e.r as number) >= 1 &&
    (e.r as number) <= KDF_LIMITS.maxR &&
    Number.isInteger(e.p) &&
    (e.p as number) >= 1 &&
    (e.p as number) <= KDF_LIMITS.maxP &&
    typeof e.salt === 'string' &&
    (fromBase64(e.salt)?.length ?? 0) >= SALT_BYTES &&
    e.salt.length <= 128 &&
    typeof raw.data === 'string' &&
    raw.data.length > 0 &&
    raw.data.length <= DATA_MAX_LENGTH;
  if (!ok) return 'unsupported';
  return {
    app: 'Personal Daily Hub',
    format: 2,
    encryption: { kdf: 'scrypt', N: e.N as number, r: e.r as number, p: e.p as number, salt: e.salt as string, cipher: 'AES-256-GCM' },
    data: raw.data as string,
  };
}

/** Opens a protected backup. A wrong passphrase and a tampered file look the same. */
export async function openBackup(file: SealedBackup, passphrase: string): Promise<{ ok: true; json: string } | { ok: false }> {
  try {
    const key = await deriveKey(passphrase, fromBase64(file.encryption.salt)!, file.encryption);
    const bytes = await aesDecryptAsync(AESSealedData.fromCombined(file.data), key, {
      output: 'bytes',
      additionalData: header(file.encryption),
    });
    return { ok: true, json: utf8Decode(bytes) };
  } catch {
    return { ok: false };
  }
}
