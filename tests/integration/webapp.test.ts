import { describe, expect, it } from 'vitest';
import { BytesRangeReader } from '../../src/http/bytes-range-reader.js';
import { buildEntryStream } from '../../src/streaming/pipeline.js';
import { stringToBase64Url } from '../../src/utils/base64url.js';
import { collectStream } from '../../src/utils/stream.js';
import { ZipArchive } from '../../src/zip/archive.js';
import { buildZip } from '../helpers/build-zip.js';
import { createHarness, type Harness } from '../helpers/harness.js';
import { createMockOrigin } from '../helpers/mock-origin.js';

const ORIGIN = 'https://origin.example/a.zip';
const encoder = new TextEncoder();
const LIMITS = { maxBytes: 1 << 26, maxEntries: 100_000 };

async function archiveBytes(): Promise<Uint8Array> {
  return buildZip([
    { name: 'a.txt', data: 'alpha', method: 'deflate' },
    { name: 'dir/b.txt', data: encoder.encode('beta'.repeat(500)), method: 'deflate' },
    { name: 'c.bin', data: new Uint8Array(2000).map((_, i) => i & 0xff), method: 'stored' },
  ]);
}

async function singleHarness(): Promise<Harness> {
  const origin = createMockOrigin(await archiveBytes(), { url: ORIGIN });
  return createHarness({ fetch: origin.fetch, env: { ARCHIVE_URL: ORIGIN } });
}

async function readEntry(archive: ZipArchive, name: string): Promise<Uint8Array> {
  const entry = archive.getEntry(name)!;
  const location = await archive.resolveData(entry);
  const plan = await buildEntryStream(archive, entry, location, { kind: 'none' });
  return collectStream(plan.body);
}

describe('browser UI', () => {
  it('serves the homepage at / by default', async () => {
    const harness = await singleHarness();
    const res = await harness.request('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('archwright');
    // The homepage introduces the two directions rather than being the tool.
    expect(html).toContain('Open an archive');
    expect(html).toContain('Build an archive');
  });

  it('serves the archive tool at /extract', async () => {
    const harness = await singleHarness();
    const res = await harness.request('/extract');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('window.ZS');
  });

  it('renders a styled 404 for a browser, and JSON for an API client', async () => {
    const harness = await singleHarness();
    const page = await harness.request('/nope-not-here', { headers: { accept: 'text/html' } });
    expect(page.status).toBe(404);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(await page.text()).toContain('does not lead anywhere');

    const api = await harness.request('/nope-not-here', { headers: { accept: 'application/json' } });
    expect(api.status).toBe(404);
    expect(api.headers.get('content-type')).toContain('application/json');
  });

  it('serves the JSON index when SERVE_UI=false', async () => {
    const origin = createMockOrigin(await archiveBytes(), { url: ORIGIN });
    const harness = createHarness({ fetch: origin.fetch, env: { ARCHIVE_URL: ORIGIN, SERVE_UI: 'false' } });
    const res = await harness.request('/');
    expect(res.headers.get('content-type')).toContain('application/json');
  });
});

describe('open mode', () => {
  it('accepts any public host when ALLOW_ANY_ARCHIVE_HOST=true', async () => {
    const origin = createMockOrigin(await archiveBytes(), { url: ORIGIN });
    const harness = createHarness({ fetch: origin.fetch, env: { ALLOW_ANY_ARCHIVE_HOST: 'true' } });
    const res = await harness.request(`/a/${stringToBase64Url(ORIGIN)}/__/list`);
    expect(res.status).toBe(200);
  });

  it('still blocks private hosts even in open mode', async () => {
    const origin = createMockOrigin(await archiveBytes(), { url: ORIGIN });
    const harness = createHarness({ fetch: origin.fetch, env: { ALLOW_ANY_ARCHIVE_HOST: 'true' } });
    const res = await harness.request(`/a/${stringToBase64Url('http://169.254.169.254/a.zip')}/__/list`);
    expect(res.status).toBe(403);
  });

  it('refuses arbitrary hosts when open mode is off and no allowlist is set', async () => {
    const origin = createMockOrigin(await archiveBytes(), { url: ORIGIN });
    const harness = createHarness({ fetch: origin.fetch, env: {} });
    const res = await harness.request(`/a/${stringToBase64Url(ORIGIN)}/__/list`);
    expect(res.status).toBe(403);
  });
});

describe('combined ZIP download', () => {
  it('streams a valid ZIP of the selected files with an exact Content-Length', async () => {
    const harness = await singleHarness();
    const res = await harness.request('/__/zip?path=a.txt&path=c.bin&name=pick');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toContain('pick.zip');
    expect(res.headers.get('x-zip-entries')).toBe('2');

    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(String(bytes.byteLength)).toBe(res.headers.get('content-length'));

    const out = await ZipArchive.open(new BytesRangeReader(bytes), LIMITS);
    expect(out.entries.map((e) => e.name).sort()).toEqual(['a.txt', 'c.bin']);
    expect(await readEntry(out, 'a.txt')).toEqual(encoder.encode('alpha'));
  });

  it('answers HEAD with the size and no body', async () => {
    const harness = await singleHarness();
    const res = await harness.request('/__/zip?path=a.txt', { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(Number(res.headers.get('content-length'))).toBeGreaterThan(0);
    expect(await res.text()).toBe('');
  });

  it('rejects an empty selection with 400', async () => {
    const harness = await singleHarness();
    expect((await harness.request('/__/zip')).status).toBe(400);
  });

  it('404s when a selected file is missing', async () => {
    const harness = await singleHarness();
    expect((await harness.request('/__/zip?path=nope.txt')).status).toBe(404);
  });

  it('rejects too many files with 413', async () => {
    const origin = createMockOrigin(await archiveBytes(), { url: ORIGIN });
    const harness = createHarness({
      fetch: origin.fetch,
      env: { ARCHIVE_URL: ORIGIN, MAX_ZIP_ENTRIES: '1' },
    });
    const res = await harness.request('/__/zip?path=a.txt&path=c.bin');
    expect(res.status).toBe(413);
  });
});
