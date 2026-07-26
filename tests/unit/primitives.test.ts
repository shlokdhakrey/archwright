import { describe, expect, it } from 'vitest';
import {
  base64UrlToString,
  bytesToBase64Url,
  base64UrlToBytes,
  stringToBase64Url,
} from '../../src/utils/base64url.js';
import { ByteView, bytesEqual, concatBytes, lastIndexOfUint32LE } from '../../src/utils/bytes.js';
import { contentTypeFromName } from '../../src/http/content-type.js';
import { crc32 } from '../../src/zip/crc32.js';
import { decodeCp437 } from '../../src/zip/cp437.js';
import { dosDateTimeToEpochMs } from '../../src/zip/dos-time.js';
import { hasControlCharacters, sanitizeHeaderValue } from '../../src/security/sanitize.js';

const encoder = new TextEncoder();

describe('ByteView', () => {
  it('reads little-endian integers', () => {
    const view = new ByteView(new Uint8Array([0x02, 0x01, 0x04, 0x03, 0, 0, 0, 0]));
    expect(view.u16(0)).toBe(0x0102);
    expect(view.u32(0)).toBe(0x03040102);
    expect(view.u64(0)).toBe(0x03040102);
  });

  it('throws on out-of-bounds reads', () => {
    const view = new ByteView(new Uint8Array(2));
    expect(() => view.u32(0)).toThrow(RangeError);
  });

  it('copy() detaches from the backing buffer', () => {
    const source = new Uint8Array([1, 2, 3, 4]);
    const view = new ByteView(source);
    const copy = view.copy(1, 2);
    source[1] = 99;
    expect(Array.from(copy)).toEqual([2, 3]);
  });
});

describe('byte helpers', () => {
  it('finds the last occurrence of a uint32 signature', () => {
    const bytes = new Uint8Array([0, 0x50, 0x4b, 0x05, 0x06, 0, 0x50, 0x4b, 0x05, 0x06]);
    expect(lastIndexOfUint32LE(bytes, 0x06054b50)).toBe(6);
  });

  it('concatenates chunks', () => {
    expect(Array.from(concatBytes([new Uint8Array([1, 2]), new Uint8Array([3])]))).toEqual([1, 2, 3]);
  });

  it('compares byte arrays', () => {
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(bytesEqual(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
  });
});

describe('crc32', () => {
  it('matches the canonical check value', () => {
    expect(crc32(encoder.encode('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });

  it('is zero for empty input', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('decodeCp437', () => {
  it('maps ASCII directly and high bytes to CP437 glyphs', () => {
    expect(decodeCp437(new Uint8Array([0x41, 0x42]))).toBe('AB');
    expect(decodeCp437(new Uint8Array([0x80]))).toBe('Ç');
    expect(decodeCp437(new Uint8Array([0xe1]))).toBe('ß');
  });
});

describe('dosDateTimeToEpochMs', () => {
  it('decodes the DOS epoch', () => {
    expect(dosDateTimeToEpochMs(0, 0x21)).toBe(Date.UTC(1980, 0, 1, 0, 0, 0));
  });

  it('decodes a specific timestamp', () => {
    // 2020-06-15 12:30:20 → date=(40<<9)|(6<<5)|15, time=(12<<11)|(30<<5)|10
    const date = (40 << 9) | (6 << 5) | 15;
    const time = (12 << 11) | (30 << 5) | 10;
    expect(dosDateTimeToEpochMs(time, date)).toBe(Date.UTC(2020, 5, 15, 12, 30, 20));
  });

  it('falls back to the DOS epoch on invalid input', () => {
    expect(dosDateTimeToEpochMs(0, 0)).toBe(Date.UTC(1980, 0, 1, 0, 0, 0));
  });
});

describe('base64url', () => {
  it('round-trips strings', () => {
    const value = 'https://x/y?a=1&b=ω';
    expect(base64UrlToString(stringToBase64Url(value))).toBe(value);
  });

  it('round-trips bytes and is URL-safe', () => {
    const bytes = new Uint8Array([251, 252, 253, 254, 255]);
    const encoded = bytesToBase64Url(bytes);
    expect(encoded).not.toMatch(/[+/=]/);
    expect(Array.from(base64UrlToBytes(encoded))).toEqual(Array.from(bytes));
  });
});

describe('content type', () => {
  it('maps known extensions', () => {
    expect(contentTypeFromName('a/b/movie.mkv')).toBe('video/x-matroska');
    expect(contentTypeFromName('photo.JPG')).toBe('image/jpeg');
  });

  it('falls back to octet-stream', () => {
    expect(contentTypeFromName('unknown.zzz')).toBe('application/octet-stream');
    expect(contentTypeFromName('noext')).toBe('application/octet-stream');
  });
});

describe('header sanitisation', () => {
  it('detects and strips control characters', () => {
    const dirty = 'value\r\nInjected: header';
    expect(hasControlCharacters(dirty)).toBe(true);
    expect(sanitizeHeaderValue(dirty)).toBe('valueInjected: header');
  });
});
