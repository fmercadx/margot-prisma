// UTF-8 to and from bytes, for the encryption layer.
//
// Hermes's TextEncoder/TextDecoder support has varied between React Native
// releases, so this does not depend on either. Covers the whole Unicode
// range, including emoji (surrogate pairs), which notes will contain.

export function utf8Encode(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const low = s.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (low - 0xdc00);
        i++;
      }
    }
    if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd; // a lone surrogate is not valid UTF-8
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

export function utf8Decode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i];
    let c: number;
    let n: number;
    if (b < 0x80) [c, n] = [b, 1];
    else if (b >= 0xc2 && b < 0xe0) [c, n] = [b & 31, 2];
    else if (b >= 0xe0 && b < 0xf0) [c, n] = [b & 15, 3];
    else if (b >= 0xf0 && b < 0xf5) [c, n] = [b & 7, 4];
    else {
      s += '�';
      i++;
      continue;
    }
    if (i + n > bytes.length) {
      s += '�';
      break;
    }
    let ok = true;
    for (let k = 1; k < n; k++) {
      const cont = bytes[i + k];
      if ((cont & 0xc0) !== 0x80) ok = false;
      c = (c << 6) | (cont & 63);
    }
    if (!ok) {
      s += '�';
      i++;
      continue;
    }
    if (c >= 0x10000) {
      c -= 0x10000;
      s += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 1023));
    } else {
      s += String.fromCharCode(c);
    }
    i += n;
  }
  return s;
}
