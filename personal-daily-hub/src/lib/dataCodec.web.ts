// The web demo has no secure key store (expo-secure-store is native only),
// so it keeps plain JSON in localStorage. Metro picks this file for web.

import { plainCodec, type Codec } from './codec';

export async function createDataCodec(): Promise<Codec> {
  return plainCodec;
}
