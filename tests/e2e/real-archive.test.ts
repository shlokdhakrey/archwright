import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';

/**
 * Opt-in end-to-end test against a REAL remote archive over the network. It
 * drives the actual application (`createApp` with the real global `fetch`), so
 * it exercises the complete pipeline — HTTP range reads, ZIP parsing, streaming
 * inflate — against bytes on the internet.
 *
 * Skipped unless configured, so `npm test` and CI stay offline and fast:
 *
 *   E2E_ARCHIVE_URL="https://.../archive.zip" \
 *   E2E_ENTRY_PATH="movie.mkv" \
 *   npx vitest run tests/e2e/real-archive.test.ts
 */
const ARCHIVE_URL = process.env.E2E_ARCHIVE_URL;
const ENTRY_PATH = process.env.E2E_ENTRY_PATH;
const enabled = Boolean(ARCHIVE_URL && ENTRY_PATH);

const executionCtx = {
  waitUntil: (): void => undefined,
  passThroughOnException: (): void => undefined,
  props: {},
} as unknown as ExecutionContext;

function makeApp(): { fetch: (path: string, init?: RequestInit) => Promise<Response> } {
  const app = createApp(); // real global fetch, no cache (Noop in Node)
  const env = { ARCHIVE_URL: ARCHIVE_URL ?? '', LOG_LEVEL: 'silent' };
  return {
    fetch: (path, init) => app.fetch(new Request(`https://worker.example${path}`, init), env, executionCtx),
  };
}

describe.skipIf(!enabled)('end-to-end against a real archive', () => {
  const app = makeApp();
  const entry = `/${ENTRY_PATH ?? ''}`;

  it('lists the target entry', async () => {
    const res = await app.fetch('/__/list');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: { name: string }[] };
    expect(body.entries.some((e) => e.name === ENTRY_PATH)).toBe(true);
  });

  it('HEAD reports the exact size and range support', async () => {
    const res = await app.fetch(entry, { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(Number(res.headers.get('content-length'))).toBeGreaterThan(0);
  });

  it('streams a byte range and decodes real content', async () => {
    const res = await app.fetch(entry, { headers: { range: 'bytes=0-1048575' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-length')).toBe('1048576');
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body.byteLength).toBe(1048576);
    // The included fixture is a Matroska file — verify the EBML magic so we know
    // the DEFLATE stream was inflated correctly from the archive.
    if (ENTRY_PATH?.endsWith('.mkv')) {
      expect(Array.from(body.subarray(0, 4))).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
    }
  });
});
