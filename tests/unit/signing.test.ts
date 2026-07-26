import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '../../src/errors/http-error.js';
import { signArchiveRef, verifyArchiveRef } from '../../src/security/signing.js';

const SECRET = 'test-signing-secret';
const NOW = 1_700_000_000_000;

describe('signed archive references', () => {
  it('round-trips a signed reference', async () => {
    const token = await signArchiveRef(SECRET, 'https://storage.googleapis.com/b/a.zip');
    const result = await verifyArchiveRef(SECRET, token, NOW);
    expect(result.url).toBe('https://storage.googleapis.com/b/a.zip');
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signArchiveRef('other-secret', 'https://x/a.zip');
    await expect(verifyArchiveRef(SECRET, token, NOW)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rejects a tampered payload', async () => {
    const token = await signArchiveRef(SECRET, 'https://x/a.zip');
    const [, sig] = token.split('.');
    const forged = `${btoa('{"u":"https://evil/a.zip"}').replace(/=+$/, '')}.${sig ?? ''}`;
    await expect(verifyArchiveRef(SECRET, forged, NOW)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('honours expiry', async () => {
    const token = await signArchiveRef(SECRET, 'https://x/a.zip', NOW - 1000);
    await expect(verifyArchiveRef(SECRET, token, NOW)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('accepts a not-yet-expired reference', async () => {
    const token = await signArchiveRef(SECRET, 'https://x/a.zip', NOW + 60_000);
    const result = await verifyArchiveRef(SECRET, token, NOW);
    expect(result.url).toBe('https://x/a.zip');
  });

  it('rejects a malformed token', async () => {
    await expect(verifyArchiveRef(SECRET, 'garbage', NOW)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
