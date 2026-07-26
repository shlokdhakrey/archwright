/** URL-safe base64 (RFC 4648 §5) without padding, for cache keys and archive refs. */

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  // Chunked to avoid exceeding the argument limit of String.fromCharCode on
  // large inputs; cache keys and refs are small, but this stays correct anyway.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBytes(value: string): Uint8Array {
  const normalised = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalised + '='.repeat((4 - (normalised.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function stringToBase64Url(value: string): string {
  return bytesToBase64Url(textEncoder.encode(value));
}

/** Decode a base64url string to UTF-8 text. Throws on invalid UTF-8. */
export function base64UrlToString(value: string): string {
  return textDecoder.decode(base64UrlToBytes(value));
}
