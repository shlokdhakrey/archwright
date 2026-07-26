import { ForbiddenError } from '../errors/http-error.js';
import {
  base64UrlToBytes,
  base64UrlToString,
  bytesToBase64Url,
  stringToBase64Url,
} from '../utils/base64url.js';

/**
 * HMAC-SHA256 signed archive references for multi-archive mode.
 *
 * A signed ref is `base64url(payload).base64url(sig)`, where `payload` is a tiny
 * JSON document (`{u: url, e?: expiry}`) and `sig` is its HMAC. Signatures are
 * verified with the Web Crypto `verify` primitive (constant-time), letting an
 * operator hand out short-lived, tamper-proof links without exposing an open
 * proxy. See `docs/security.md`.
 */

const encoder = new TextEncoder();

export interface SignedArchiveRef {
  readonly url: string;
  readonly expiresAt?: number;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

/** Produce a signed token for `url`, optionally expiring at `expiresAt` (epoch ms). */
export async function signArchiveRef(secret: string, url: string, expiresAt?: number): Promise<string> {
  const payload = JSON.stringify({ u: url, ...(expiresAt !== undefined ? { e: expiresAt } : {}) });
  const payloadB64 = stringToBase64Url(payload);
  const key = await importKey(secret);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payloadB64)));
  return `${payloadB64}.${bytesToBase64Url(signature)}`;
}

/** Verify a signed token, returning the referenced URL or throwing 403. */
export async function verifyArchiveRef(
  secret: string,
  token: string,
  now: number,
): Promise<SignedArchiveRef> {
  try {
    const dot = token.indexOf('.');
    if (dot <= 0 || dot === token.length - 1) {
      throw new ForbiddenError('malformed signed archive reference');
    }
    const payloadB64 = token.slice(0, dot);
    const signature = base64UrlToBytes(token.slice(dot + 1));
    const key = await importKey(secret);
    const valid = await crypto.subtle.verify('HMAC', key, signature, encoder.encode(payloadB64));
    if (!valid) {
      throw new ForbiddenError('invalid archive reference signature');
    }
    const parsed = JSON.parse(base64UrlToString(payloadB64)) as { u?: unknown; e?: unknown };
    if (typeof parsed.u !== 'string') {
      throw new ForbiddenError('malformed signed archive payload');
    }
    if (typeof parsed.e === 'number' && now > parsed.e) {
      throw new ForbiddenError('signed archive reference has expired');
    }
    return { url: parsed.u, ...(typeof parsed.e === 'number' ? { expiresAt: parsed.e } : {}) };
  } catch (error) {
    if (error instanceof ForbiddenError) throw error;
    throw new ForbiddenError('invalid signed archive reference');
  }
}
