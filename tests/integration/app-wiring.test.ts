import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { resetDirectoryMemo } from '../../src/cache/central-directory-cache.js';
import { createHarness } from '../helpers/harness.js';
import { buildZip } from '../helpers/build-zip.js';
import { createMockOrigin } from '../helpers/mock-origin.js';

const executionCtx = {
  waitUntil: (): void => undefined,
  passThroughOnException: (): void => undefined,
  props: {},
} as unknown as ExecutionContext;

describe('app wiring', () => {
  it('assembles default collaborators (no cache injection) and serves a request', async () => {
    resetDirectoryMemo();
    const zip = await buildZip([{ name: 'x.txt', data: 'hi' }]);
    const origin = createMockOrigin(zip, { url: 'https://origin.example/a.zip' });
    const app = createApp({ fetch: origin.fetch });

    const res = await app.fetch(
      new Request('https://worker.example/x.txt'),
      { ARCHIVE_URL: origin.url, LOG_LEVEL: 'silent' },
      executionCtx,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('hi');
  });
});

describe('CORS origin resolution', () => {
  async function harnessWith(corsAllowOrigin: string): Promise<ReturnType<typeof createHarness>> {
    const zip = await buildZip([{ name: 'x.txt', data: 'hi' }]);
    const origin = createMockOrigin(zip, { url: 'https://origin.example/a.zip' });
    return createHarness({
      fetch: origin.fetch,
      env: { ARCHIVE_URL: origin.url, CORS_ALLOW_ORIGIN: corsAllowOrigin },
    });
  }

  it('reflects an allowlisted origin and sets Vary', async () => {
    const harness = await harnessWith('https://a.example,https://b.example');
    const res = await harness.request('/x.txt', { headers: { origin: 'https://a.example' } });
    expect(res.headers.get('access-control-allow-origin')).toBe('https://a.example');
    expect(res.headers.get('vary')).toContain('Origin');
  });

  it('omits the header for a non-allowlisted origin', async () => {
    const harness = await harnessWith('https://a.example,https://b.example');
    const res = await harness.request('/x.txt', { headers: { origin: 'https://evil.example' } });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});
