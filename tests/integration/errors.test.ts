import { describe, expect, it } from 'vitest';
import { createHarness } from '../helpers/harness.js';
import { buildZip } from '../helpers/build-zip.js';
import { createMockOrigin } from '../helpers/mock-origin.js';
import { signArchiveRef } from '../../src/security/signing.js';
import { stringToBase64Url } from '../../src/utils/base64url.js';

const ORIGIN_URL = 'https://origin.example/a.zip';
const encoder = new TextEncoder();

async function zipBytes(): Promise<Uint8Array> {
  return buildZip([{ name: 'movie.bin', data: encoder.encode('hello world'), method: 'stored' }]);
}

describe('multi-archive addressing', () => {
  it('refuses to proxy without an allowlist or signing secret', async () => {
    const origin = createMockOrigin(await zipBytes(), { url: ORIGIN_URL });
    const harness = createHarness({ fetch: origin.fetch, env: {} });
    const ref = stringToBase64Url(ORIGIN_URL);
    const res = await harness.request(`/a/${ref}/movie.bin`);
    expect(res.status).toBe(403);
  });

  it('serves a base64url reference when the host is allowlisted', async () => {
    const origin = createMockOrigin(await zipBytes(), { url: ORIGIN_URL });
    const harness = createHarness({
      fetch: origin.fetch,
      env: { ALLOWED_ARCHIVE_HOSTS: 'origin.example' },
    });
    const ref = stringToBase64Url(ORIGIN_URL);
    const res = await harness.request(`/a/${ref}/movie.bin`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('hello world');
  });

  it('serves a signed reference', async () => {
    const origin = createMockOrigin(await zipBytes(), { url: ORIGIN_URL });
    const harness = createHarness({ fetch: origin.fetch, env: { ARCHIVE_SIGNING_SECRET: 'secret' } });
    const token = await signArchiveRef('secret', ORIGIN_URL);
    const res = await harness.request(`/a/${token}/movie.bin`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('hello world');
  });

  it('rejects a tampered signed reference', async () => {
    const origin = createMockOrigin(await zipBytes(), { url: ORIGIN_URL });
    const harness = createHarness({ fetch: origin.fetch, env: { ARCHIVE_SIGNING_SECRET: 'secret' } });
    const token = await signArchiveRef('secret', ORIGIN_URL);
    const res = await harness.request(`/a/${token}x/movie.bin`);
    expect(res.status).toBe(403);
  });
});

describe('resilience', () => {
  it('retries transient origin failures and eventually succeeds', async () => {
    const origin = createMockOrigin(await zipBytes(), { url: ORIGIN_URL, failTimes: 2 });
    const harness = createHarness({
      fetch: origin.fetch,
      env: { ARCHIVE_URL: ORIGIN_URL, ORIGIN_RETRIES: '3' },
    });
    const res = await harness.request('/movie.bin');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('hello world');
  });
});

describe('malformed archives', () => {
  it('returns 502 with a malformed_archive code for non-ZIP content', async () => {
    const junk = new Uint8Array(2000).fill(0x41);
    const origin = createMockOrigin(junk, { url: ORIGIN_URL });
    const harness = createHarness({ fetch: origin.fetch, env: { ARCHIVE_URL: ORIGIN_URL } });
    const res = await harness.request('/movie.bin');
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('malformed_archive');
  });
});
