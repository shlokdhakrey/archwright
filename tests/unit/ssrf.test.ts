import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '../../src/errors/http-error.js';
import { isBlockedHost, validateArchiveUrl } from '../../src/security/ssrf.js';

describe('isBlockedHost', () => {
  it.each([
    'localhost',
    'app.localhost',
    'db.internal',
    '127.0.0.1',
    '10.0.0.5',
    '172.16.1.1',
    '192.168.1.1',
    '169.254.169.254',
    '0.0.0.0',
    '::1',
    'fe80::1',
    'fc00::1',
    '::ffff:127.0.0.1',
  ])('blocks %s', (host) => {
    expect(isBlockedHost(host)).toBe(true);
  });

  it.each(['example.com', 'storage.googleapis.com', '8.8.8.8', '93.184.216.34'])('allows %s', (host) => {
    expect(isBlockedHost(host)).toBe(false);
  });

  // `URL.hostname` returns IPv6 literals bracketed and IPv4-mapped addresses in
  // hex — these are the exact forms the guard must handle.
  it.each([
    '[::1]',
    '[fe80::1]',
    '[fd00::1]',
    '[::ffff:127.0.0.1]',
    '[::ffff:7f00:1]', // hex-normalised 127.0.0.1
    '[::ffff:a9fe:a9fe]', // hex-normalised 169.254.169.254 (cloud metadata)
  ])('blocks bracketed IPv6 %s', (host) => {
    expect(isBlockedHost(host)).toBe(true);
  });

  it('allows a public IPv6 literal', () => {
    expect(isBlockedHost('[2001:db8::1]')).toBe(false);
  });
});

describe('validateArchiveUrl', () => {
  const allow = new Set(['storage.googleapis.com']);

  it('accepts an allowlisted https URL', () => {
    const url = validateArchiveUrl('https://storage.googleapis.com/bucket/a.zip?x=1', allow);
    expect(url.hostname).toBe('storage.googleapis.com');
  });

  it('rejects a host that is not allowlisted', () => {
    expect(() => validateArchiveUrl('https://evil.example/a.zip', allow)).toThrow(ForbiddenError);
  });

  it('rejects a private-range host even if the allowlist is empty', () => {
    expect(() => validateArchiveUrl('http://169.254.169.254/latest/meta-data', new Set())).toThrow(
      ForbiddenError,
    );
  });

  it('rejects non-http(s) schemes', () => {
    expect(() => validateArchiveUrl('file:///etc/passwd', new Set())).toThrow(ForbiddenError);
    expect(() => validateArchiveUrl('gopher://x/', new Set())).toThrow(ForbiddenError);
  });

  it('rejects embedded credentials', () => {
    expect(() => validateArchiveUrl('https://user:pass@storage.googleapis.com/a.zip', allow)).toThrow(
      ForbiddenError,
    );
  });

  it('rejects a malformed URL', () => {
    expect(() => validateArchiveUrl('not a url', allow)).toThrow();
  });

  it('rejects IPv6 loopback and mapped-metadata URLs', () => {
    expect(() => validateArchiveUrl('http://[::1]/a.zip', new Set())).toThrow(ForbiddenError);
    expect(() => validateArchiveUrl('http://[::ffff:169.254.169.254]/', new Set())).toThrow(ForbiddenError);
  });
});
