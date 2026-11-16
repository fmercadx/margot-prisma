import AsyncStorage from '@react-native-async-storage/async-storage';

import { isSealed, plainCodec, SEALED_PREFIX } from '../src/lib/codec';
import { createDataCodec } from '../src/lib/dataCodec';
import {
  createPersister,
  dayStorageKey,
  ensureSealed,
  HABITS_KEY,
  loadDays,
  loadHabits,
  setCodec,
} from '../src/lib/storage';
import { utf8Decode, utf8Encode } from '../src/lib/utf8';

// Jest runs on Node, which has Buffer; the app's own types deliberately do
// not include Node's, because the phone's JavaScript engine has no Buffer.
declare const Buffer: any;

const SecureStore = jest.requireMock('expo-secure-store');
const ExpoCrypto = jest.requireMock('expo-crypto');

beforeEach(async () => {
  await AsyncStorage.clear();
  SecureStore.__items.clear();
  jest.clearAllMocks();
  setCodec(plainCodec);
});

describe('utf8', () => {
  test.each(['', 'plain ascii', 'café crème', '日本語のメモ', 'emoji 🔥💧 ok', '\u0000 null and ￿'])(
    'round-trips %j and matches the platform encoder',
    (s) => {
      expect(Buffer.from(utf8Encode(s)).equals(Buffer.from(s, 'utf8'))).toBe(true);
      expect(utf8Decode(utf8Encode(s))).toBe(s);
    },
  );

  test('a lone surrogate becomes U+FFFD rather than invalid bytes', () => {
    expect(utf8Decode(utf8Encode('a\ud800b'))).toBe('a�b');
  });

  test('malformed bytes decode to U+FFFD instead of throwing', () => {
    expect(utf8Decode(Uint8Array.from([0x61, 0xff, 0x62]))).toBe('a�b');
    expect(utf8Decode(Uint8Array.from([0xe6, 0x97]))).toBe('�');
  });
});

describe('the data codec', () => {
  const KEY = dayStorageKey('2026-11-08');
  const json = JSON.stringify({ notes: [{ id: 'n', text: 'Call the dentist', createdAt: 1 }] });

  test('seals to ciphertext that does not contain the plaintext, and opens it again', async () => {
    const codec = await createDataCodec();
    const stored = await codec.seal(KEY, json);
    expect(codec.encrypted).toBe(true);
    expect(stored.startsWith(SEALED_PREFIX)).toBe(true);
    expect(stored).not.toContain('dentist');
    expect(Buffer.from(stored.slice(SEALED_PREFIX.length), 'base64').toString('latin1')).not.toContain('dentist');
    expect(await codec.open(KEY, stored)).toBe(json);
  });

  test('every seal uses a fresh nonce, so equal values never look equal on disk', async () => {
    const codec = await createDataCodec();
    const a = await codec.seal(KEY, json);
    const b = await codec.seal(KEY, json);
    expect(a).not.toBe(b);
    expect(new Set(ExpoCrypto.__nonces).size).toBe(ExpoCrypto.__nonces.length);
  });

  test('a value moved to another storage key will not open (the key is authenticated)', async () => {
    const codec = await createDataCodec();
    const stored = await codec.seal(KEY, json);
    await expect(codec.open(dayStorageKey('2026-11-07'), stored)).rejects.toThrow();
  });

  test('a single flipped byte will not open', async () => {
    const codec = await createDataCodec();
    const bytes = Buffer.from((await codec.seal(KEY, json)).slice(SEALED_PREFIX.length), 'base64');
    bytes[20] ^= 0x01;
    await expect(codec.open(KEY, SEALED_PREFIX + bytes.toString('base64'))).rejects.toThrow();
  });

  test('the key is made once, kept in secure storage, and reused on the next launch', async () => {
    const first = await createDataCodec();
    const stored = await first.seal(KEY, json);
    expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1);
    expect(SecureStore.setItemAsync.mock.calls[0][2]).toEqual({
      keychainAccessible: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
    });

    const second = await createDataCodec(); // "next launch"
    expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1);
    expect(await second.open(KEY, stored)).toBe(json);
  });

  test('a different key cannot open the data', async () => {
    const stored = await (await createDataCodec()).seal(KEY, json);
    SecureStore.__items.clear(); // key lost, e.g. secure storage was reset
    await expect((await createDataCodec()).open(KEY, stored)).rejects.toThrow();
  });

  test('if the key cannot be read, no new key is made', async () => {
    await createDataCodec();
    SecureStore.getItemAsync.mockRejectedValueOnce(new Error('Keystore unavailable'));
    await expect(createDataCodec()).rejects.toThrow('Keystore unavailable');
    expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1); // only the first launch's
  });
});

describe('storage with encryption on', () => {
  const rawValues = async () => {
    const keys = await AsyncStorage.getAllKeys();
    return Object.fromEntries(await AsyncStorage.multiGet(keys)) as Record<string, string>;
  };

  test('plain JSON from version 1.0 is encrypted at launch and still reads back', async () => {
    await AsyncStorage.multiSet([
      [dayStorageKey('2026-11-07'), JSON.stringify({ water: 3, notes: [{ id: 'a', text: 'Old note', createdAt: 1 }] })],
      [HABITS_KEY, JSON.stringify([{ id: 'h1', label: 'Stretch', core: false }])],
      ['unrelated-key', 'left alone'],
    ]);

    setCodec(await createDataCodec());
    expect(await ensureSealed()).toBe(2);

    const raw = await rawValues();
    expect(isSealed(raw[dayStorageKey('2026-11-07')])).toBe(true);
    expect(isSealed(raw[HABITS_KEY])).toBe(true);
    expect(raw[dayStorageKey('2026-11-07')]).not.toContain('Old note');
    expect(raw['unrelated-key']).toBe('left alone');

    expect((await loadDays(['2026-11-07']))['2026-11-07'].notes[0].text).toBe('Old note');
    expect((await loadHabits()).map((h) => h.label)).toContain('Stretch');

    // Second launch: nothing left to do.
    expect(await ensureSealed()).toBe(0);
  });

  test('the writer stores only ciphertext', async () => {
    setCodec(await createDataCodec());
    const p = createPersister({ delayMs: 0 });
    p.schedule(dayStorageKey('2026-11-08'), { notes: [{ id: 'n', text: 'Secret plan', createdAt: 1 }] });
    await p.flush();
    const raw = await rawValues();
    expect(isSealed(raw[dayStorageKey('2026-11-08')])).toBe(true);
    expect(JSON.stringify(raw)).not.toContain('Secret plan');
    expect((await loadDays(['2026-11-08']))['2026-11-08'].notes[0].text).toBe('Secret plan');
  });

  test('a value that will not decrypt is kept aside, and that day starts empty', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    setCodec(await createDataCodec());
    const p = createPersister({ delayMs: 0 });
    p.schedule(dayStorageKey('2026-11-08'), { water: 4 });
    await p.flush();
    const original = (await rawValues())[dayStorageKey('2026-11-08')];

    SecureStore.__items.clear();
    setCodec(await createDataCodec()); // a different key

    expect(await loadDays(['2026-11-08'])).toEqual({});
    const raw = await rawValues();
    const copy = Object.keys(raw).find((k) => k.includes('corrupt') && k.endsWith(dayStorageKey('2026-11-08')));
    expect(copy).toBeDefined();
    expect(raw[copy!]).toBe(original);
    warn.mockRestore();
  });
});
