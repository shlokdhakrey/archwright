import { describe, expect, it } from 'vitest';
import { buildZip } from '../helpers/build-zip.js';
import { createHarness, type Harness } from '../helpers/harness.js';
import { createMockOrigin } from '../helpers/mock-origin.js';

const encoder = new TextEncoder();

async function setup(): Promise<Harness> {
  const zip = await buildZip([
    { name: 'clip.mp4', data: new Uint8Array(512).fill(3), method: 'stored' },
    { name: 'notes.txt', data: encoder.encode('hi'), method: 'stored' },
  ]);
  const origin = createMockOrigin(zip, { url: 'https://origin.example/a.zip' });
  return createHarness({ fetch: origin.fetch, env: { ARCHIVE_URL: origin.url } });
}

describe('favicon', () => {
  it('inlines the icon in rendered pages so no second request is made', async () => {
    const harness = await setup();

    // On Workers a /favicon.ico hit is a billed invocation, so the point of the
    // inline `data:` URI is that the browser never asks for one.
    const home = await (await harness.request('/')).text();
    expect(home).toContain('rel="icon"');
    expect(home).toContain('href="data:image/svg+xml,');

    const player = await (await harness.request('/__/play/clip.mp4')).text();
    expect(player).toContain('rel="icon"');
    expect(player).toContain('href="data:image/svg+xml,');
  });

  it('still answers /favicon.ico, cached hard, for clients that ask anyway', async () => {
    const harness = await setup();
    const res = await harness.request('/favicon.ico');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/svg+xml');
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(await res.text()).toContain('<svg');
  });

  it('answers HEAD without a body', async () => {
    const harness = await setup();
    const res = await harness.request('/favicon.ico', { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });

  it('is served without touching the archive origin', async () => {
    const zip = await buildZip([{ name: 'a.txt', data: encoder.encode('x'), method: 'stored' }]);
    const origin = createMockOrigin(zip, { url: 'https://origin.example/a.zip' });
    const harness = createHarness({ fetch: origin.fetch, env: { ARCHIVE_URL: origin.url } });
    await harness.request('/favicon.ico');
    expect(origin.callCount()).toBe(0);
  });
});
