// Native modules have no implementation under Jest; these stand in for them.

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

// An in-memory notification scheduler, so reminder tests can see what would fire.
jest.mock('expo-notifications', () => {
  const scheduled = new Map();
  const granted = { granted: true, canAskAgain: true, status: 'granted' };
  return {
    __scheduled: scheduled,
    setNotificationHandler: jest.fn(),
    setNotificationChannelAsync: jest.fn(async () => null),
    getPermissionsAsync: jest.fn(async () => granted),
    requestPermissionsAsync: jest.fn(async () => granted),
    scheduleNotificationAsync: jest.fn(async (req) => {
      scheduled.set(req.identifier, req);
      return req.identifier;
    }),
    cancelScheduledNotificationAsync: jest.fn(async (id) => {
      scheduled.delete(id);
    }),
    getAllScheduledNotificationsAsync: jest.fn(async () => [...scheduled.values()]),
    AndroidImportance: { DEFAULT: 3 },
    SchedulableTriggerInputTypes: { DAILY: 'daily' },
  };
});

// AES-256-GCM backed by Node's crypto, shaped like expo-crypto's API. Real
// encryption, so tests prove values on "disk" are ciphertext and that a
// wrong key, a tampered byte or a swapped storage key all fail to open.
jest.mock('expo-crypto', () => {
  const nodeCrypto = require('crypto');
  const toBuf = (x) => (typeof x === 'string' ? Buffer.from(x, 'base64') : Buffer.from(x));
  class AESEncryptionKey {
    constructor(bytes) {
      this._b = Buffer.from(bytes);
    }
    static async generate() {
      return new AESEncryptionKey(nodeCrypto.randomBytes(32));
    }
    static async import(input, encoding) {
      return new AESEncryptionKey(typeof input === 'string' ? Buffer.from(input, encoding) : input);
    }
    async encoded(encoding) {
      return this._b.toString(encoding);
    }
    async bytes() {
      return new Uint8Array(this._b);
    }
    get size() {
      return this._b.length * 8;
    }
  }
  class AESSealedData {
    constructor(buf) {
      this._buf = buf;
    }
    static fromCombined(combined) {
      return new AESSealedData(toBuf(combined));
    }
    async combined(encoding) {
      return encoding === 'base64' ? this._buf.toString('base64') : new Uint8Array(this._buf);
    }
  }
  const nonces = [];
  async function aesEncryptAsync(plaintext, key, opts = {}) {
    const iv = nodeCrypto.randomBytes(opts.nonce?.length ?? 12);
    nonces.push(iv.toString('hex'));
    const c = nodeCrypto.createCipheriv('aes-256-gcm', key._b, iv);
    if (opts.additionalData) c.setAAD(toBuf(opts.additionalData));
    const ct = Buffer.concat([c.update(toBuf(plaintext)), c.final()]);
    return new AESSealedData(Buffer.concat([iv, ct, c.getAuthTag()]));
  }
  async function aesDecryptAsync(sealed, key, opts = {}) {
    const buf = sealed._buf;
    const d = nodeCrypto.createDecipheriv('aes-256-gcm', key._b, buf.subarray(0, 12));
    if (opts.additionalData) d.setAAD(toBuf(opts.additionalData));
    d.setAuthTag(buf.subarray(buf.length - 16));
    const pt = Buffer.concat([d.update(buf.subarray(12, buf.length - 16)), d.final()]);
    return opts.output === 'base64' ? pt.toString('base64') : new Uint8Array(pt);
  }
  return {
    __nonces: nonces,
    getRandomBytes: (n) => new Uint8Array(nodeCrypto.randomBytes(n)),
    getRandomBytesAsync: async (n) => new Uint8Array(nodeCrypto.randomBytes(n)),
    AESEncryptionKey,
    AESSealedData,
    aesEncryptAsync,
    aesDecryptAsync,
    AESKeySize: { AES128: 128, AES192: 192, AES256: 256 },
  };
});

// The Keystore / Keychain, as an in-memory map tests can inspect or break.
jest.mock('expo-secure-store', () => {
  const items = new Map();
  return {
    __items: items,
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    getItemAsync: jest.fn(async (k) => (items.has(k) ? items.get(k) : null)),
    setItemAsync: jest.fn(async (k, v) => {
      items.set(k, v);
    }),
    deleteItemAsync: jest.fn(async (k) => {
      items.delete(k);
    }),
    isAvailableAsync: jest.fn(async () => true),
  };
});

// The phone's own lock prompt. Tests flip `__level` and `__result`.
jest.mock('expo-local-authentication', () => {
  const state = { level: 3, result: { success: true } };
  return {
    __state: state,
    SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC_WEAK: 2, BIOMETRIC_STRONG: 3 },
    hasHardwareAsync: jest.fn(async () => true),
    isEnrolledAsync: jest.fn(async () => state.level > 0),
    getEnrolledLevelAsync: jest.fn(async () => state.level),
    authenticateAsync: jest.fn(async () => state.result),
    cancelAuthenticate: jest.fn(async () => {}),
  };
});

jest.mock('expo-screen-capture', () => ({
  preventScreenCaptureAsync: jest.fn(async () => {}),
  allowScreenCaptureAsync: jest.fn(async () => {}),
  enableAppSwitcherProtectionAsync: jest.fn(async () => {}),
  disableAppSwitcherProtectionAsync: jest.fn(async () => {}),
}));

// A tiny in-memory cache directory, enough for the export flow.
jest.mock('expo-file-system', () => {
  const files = new Map();
  class File {
    constructor(dirOrUri, name) {
      if (typeof dirOrUri === 'string') {
        this.uri = dirOrUri;
        this.name = dirOrUri.split('/').pop();
      } else {
        this.name = name;
        this.uri = `${dirOrUri.uri}/${name}`;
      }
    }
    async text() {
      if (!files.has(this.uri)) throw new Error('no such file');
      return files.get(this.uri);
    }
    get exists() {
      return files.has(this.uri);
    }
    create() {
      files.set(this.uri, '');
    }
    async write(content) {
      files.set(this.uri, content);
    }
    delete() {
      files.delete(this.uri);
    }
  }
  const cache = {
    uri: 'file:///cache',
    list: () => [...files.keys()].map((uri) => new File(cache, uri.split('/').pop())),
  };
  return { __files: files, File, Directory: class {}, Paths: { cache } };
});

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => {}),
}));

// The system file chooser: tests set `__next` to what the person "picks".
jest.mock('expo-document-picker', () => {
  const picker = { next: { canceled: true, assets: null } };
  return {
    __picker: picker,
    getDocumentAsync: jest.fn(async () => picker.next),
  };
});

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  impactAsync: jest.fn(async () => {}),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
}));
