// How a JSON value is turned into what AsyncStorage holds, and back.
//
// The native build encrypts (dataCodec.ts); the web demo stores plain JSON
// (dataCodec.web.ts). Storage code only ever talks to this interface.

export type Codec = {
  /** Whether stored values are encrypted. Shown in Settings. */
  encrypted: boolean;
  /** JSON text -> the string to store under `storageKey`. */
  seal(storageKey: string, json: string): Promise<string>;
  /** A stored string -> JSON text. Throws if it cannot be read. */
  open(storageKey: string, stored: string): Promise<string>;
};

/** Marks a value as AES-GCM sealed (version 1 of the format). */
export const SEALED_PREFIX = 'pdh1:';

export const isSealed = (stored: string) => stored.startsWith(SEALED_PREFIX);

export const plainCodec: Codec = {
  encrypted: false,
  seal: async (_key, json) => json,
  open: async (_key, stored) => {
    if (isSealed(stored)) throw new Error('This value is encrypted and this build has no key for it.');
    return stored;
  },
};
