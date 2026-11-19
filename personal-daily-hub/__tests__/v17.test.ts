import {
  BACKUP_KDF,
  fromBase64,
  openBackup,
  readSealedBackup,
  sealBackup,
  toBase64,
  type SealedBackup,
} from '../src/lib/backupCrypto';
import { dayAsText } from '../src/lib/dayText';
import { protectedFilename } from '../src/lib/exportJson';
import { formatCents } from '../src/lib/money';
import { CORE_HABITS, EMPTY_DAY, type DayLog } from '../src/lib/store';

// Node has Buffer; the app's own types deliberately don't.
declare const Buffer: any;

// Each test derives a real scrypt key; give them room on a slow runner.
jest.setTimeout(20_000);

const JSON_TEXT = JSON.stringify({ app: 'Personal Daily Hub', format: 1, days: { '2026-11-18': { notes: [{ id: 'n', text: 'Secret plans', createdAt: 1 }] } } });

describe('base64', () => {
  test.each([[''], ['f'], ['fo'], ['foo'], ['foob'], ['any carnal pleasure.']])('matches the platform for %j', (s) => {
    const bytes = Uint8Array.from(Buffer.from(s));
    expect(toBase64(bytes)).toBe(Buffer.from(s).toString('base64'));
    expect(Buffer.from(fromBase64(toBase64(bytes))!).toString()).toBe(s);
  });

  test('refuses what isn’t base64', () => {
    expect(fromBase64('abc')).toBeNull();
    expect(fromBase64('ab$=')).toBeNull();
  });
});

describe('protected backups', () => {
  test('seal, then open with the passphrase; the file shows nothing of what it holds', async () => {
    const text = await sealBackup(JSON_TEXT, 'correct horse battery');
    expect(text).not.toContain('Secret');
    const file = readSealedBackup(text) as SealedBackup;
    expect(file.encryption).toMatchObject({ kdf: 'scrypt', ...BACKUP_KDF, cipher: 'AES-256-GCM' });
    expect(fromBase64(file.encryption.salt)).toHaveLength(16);
    expect(await openBackup(file, 'correct horse battery')).toEqual({ ok: true, json: JSON_TEXT });
  });

  test('a wrong passphrase opens nothing, and every file gets its own salt', async () => {
    const a = readSealedBackup(await sealBackup(JSON_TEXT, 'correct horse battery')) as SealedBackup;
    const b = readSealedBackup(await sealBackup(JSON_TEXT, 'correct horse battery')) as SealedBackup;
    expect(a.encryption.salt).not.toBe(b.encryption.salt);
    expect(a.data).not.toBe(b.data);
    expect(await openBackup(a, 'correct horse batterY')).toEqual({ ok: false });
  });

  test('editing the header (cost or salt) makes it fail rather than open weaker', async () => {
    const file = readSealedBackup(await sealBackup(JSON_TEXT, 'correct horse battery')) as SealedBackup;
    const cheaper = { ...file, encryption: { ...file.encryption, N: 2 ** 14 } };
    expect(await openBackup(cheaper, 'correct horse battery')).toEqual({ ok: false });
    const bytes = fromBase64(file.data)!;
    bytes[20] ^= 1;
    expect(await openBackup({ ...file, data: toBase64(bytes) }, 'correct horse battery')).toEqual({ ok: false });
  });

  test('the same passphrase typed with a composed or decomposed accent opens it', async () => {
    const file = readSealedBackup(await sealBackup(JSON_TEXT, 'café au lait 42')) as SealedBackup;
    expect((await openBackup(file, 'café au lait 42')).ok).toBe(true);
  });

  test('a passphrase must be at least 8 characters', async () => {
    await expect(sealBackup(JSON_TEXT, 'short')).rejects.toThrow();
  });

  test('a file asking for too much memory or time is refused before any work', () => {
    const base = {
      app: 'Personal Daily Hub',
      format: 2,
      encryption: { kdf: 'scrypt', N: 2 ** 15, r: 8, p: 1, salt: toBase64(new Uint8Array(16)), cipher: 'AES-256-GCM' },
      data: 'AAAA',
    };
    const variant = (e: object) => JSON.stringify({ ...base, encryption: { ...base.encryption, ...e } });
    expect(readSealedBackup(JSON.stringify(base))).not.toBe('unsupported');
    for (const e of [{ N: 2 ** 20 }, { N: 3000 }, { N: 2 ** 10 }, { r: 64 }, { p: 16 }, { kdf: 'pbkdf2' }, { cipher: 'none' }, { salt: 'AAAA' }]) {
      expect(readSealedBackup(variant(e))).toBe('unsupported');
    }
    expect(readSealedBackup(JSON.stringify({ ...base, data: 'x'.repeat(9 * 1024 * 1024) }))).toBe('unsupported');
  });

  test('a plain backup, or something else entirely, is not a protected one', () => {
    expect(readSealedBackup(JSON_TEXT)).toBeNull();
    expect(readSealedBackup('not json')).toBeNull();
    expect(readSealedBackup('{"app":"Other","format":2,"encryption":{}}')).toBeNull();
  });

  test('a protected file’s name says so', () => {
    expect(protectedFilename('personal-daily-hub-2026-11-19.json')).toBe('personal-daily-hub-2026-11-19-protected.json');
  });
});

describe('a day as text', () => {
  const day: DayLog = {
    ...EMPTY_DAY,
    focus: 'Ship it',
    habitsDone: ['core-read'],
    water: 6,
    sleep: 7.5,
    energy: 7,
    mood: 4,
    expenses: [{ id: 'e', cents: 1250, label: 'Lunch', category: 'food', createdAt: new Date(2026, 10, 18, 13).getTime() }],
    notes: [
      { id: 't', text: 'Buy milk', createdAt: new Date(2026, 10, 18, 9, 5).getTime(), task: true, doneAt: 2 },
      { id: 'n', text: 'Idea', createdAt: new Date(2026, 10, 18, 8, 0).getTime() },
    ],
    journal: 'Good day.\nLong walk.',
  };

  test('everything logged, in order, in plain words', () => {
    expect(dayAsText('2026-11-18', day, [...CORE_HABITS], 8, formatCents).split('\n')).toEqual([
      'Wednesday, November 18, 2026',
      'Focus: Ship it',
      'Habits 1/4: Read 20 pages',
      'Water 6/8 · Sleep 7½ h · Energy 7/10 · Mood Good',
      'Spent $12.50',
      '  Lunch (Food) $12.50',
      'Notes',
      '  • Idea (8:00 AM)',
      '  [x] Buy milk (9:05 AM)',
      'Journal',
      '  Good day.',
      '  Long walk.',
    ]);
  });

  test('hidden amounts stay hidden; an empty day says so', () => {
    expect(dayAsText('2026-11-18', day, [...CORE_HABITS], 8, () => '$•••')).not.toContain('12.50');
    expect(dayAsText('2026-11-18', EMPTY_DAY, [...CORE_HABITS], 8, formatCents)).toBe('Wednesday, November 18, 2026\nNothing logged.');
  });
});
