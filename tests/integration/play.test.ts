import { describe, expect, it } from 'vitest';
import type { Env } from '../../src/types/env.js';
import { buildZip } from '../helpers/build-zip.js';
import { createHarness, type Harness } from '../helpers/harness.js';
import { createMockOrigin } from '../helpers/mock-origin.js';

const encoder = new TextEncoder();
const VIDEO = new Uint8Array(4096).map((_, i) => (i * 13) & 0xff);
const SRT = encoder.encode('1\n00:00:01,000 --> 00:00:04,500\nFirst line\n');

async function setup(env: Partial<Env> = {}): Promise<Harness> {
  const zip = await buildZip([
    { name: 'Show/S01E01.mp4', data: VIDEO, method: 'stored' },
    { name: 'Show/S01E01.en.srt', data: SRT, method: 'deflate' },
    { name: 'Show/S01E01.mkv', data: VIDEO, method: 'stored' },
    { name: 'Show/notes.txt', data: encoder.encode('hello'), method: 'stored' },
  ]);
  const origin = createMockOrigin(zip, { url: 'https://origin.example/a.zip' });
  return createHarness({ fetch: origin.fetch, env: { ARCHIVE_URL: origin.url, ...env } });
}

describe('player page', () => {
  it('renders a video element pointing at the entry, with discovered subtitles', async () => {
    const harness = await setup();
    const res = await harness.request('/__/play/Show/S01E01.mp4');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');

    const html = await res.text();
    expect(html).toContain('<video');
    // Playback is driven straight from the entry URL, rendered inline.
    expect(html).toContain('/Show/S01E01.mp4?inline');
    // The sibling subtitle is attached and converted on the fly.
    expect(html).toContain('<track');
    expect(html).toContain('/__/subtitle/Show/S01E01.en.srt');
    expect(html).toContain('srclang="en"');
    // A STORED entry seeks instantly, and the page says so.
    expect(html).toContain('Instant seeking');
  });

  it('warns when the container will not decode in a browser', async () => {
    const harness = await setup();
    const html = await (await harness.request('/__/play/Show/S01E01.mkv')).text();
    expect(html).toContain('may not play in your browser');
    expect(html).toContain('VLC');

    // An MP4 gets no such warning.
    const fine = await (await harness.request('/__/play/Show/S01E01.mp4')).text();
    expect(fine).not.toContain('may not play in your browser');
  });

  it('refuses entries that are not media, and unknown paths', async () => {
    const harness = await setup();
    expect((await harness.request('/__/play/Show/notes.txt')).status).toBe(400);
    expect((await harness.request('/__/play/Show/nope.mp4')).status).toBe(404);
  });

  it('is disabled when the UI is turned off', async () => {
    const harness = await setup({ SERVE_UI: 'false' });
    expect((await harness.request('/__/play/Show/S01E01.mp4')).status).toBe(404);
  });

  it('answers HEAD without a body', async () => {
    const harness = await setup();
    const res = await harness.request('/__/play/Show/S01E01.mp4', { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });
});

describe('subtitle conversion', () => {
  it('serves SubRip as WebVTT', async () => {
    const harness = await setup();
    const res = await harness.request('/__/subtitle/Show/S01E01.en.srt');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/vtt');

    const body = await res.text();
    expect(body.startsWith('WEBVTT')).toBe(true);
    expect(body).toContain('00:00:01.000 --> 00:00:04.500');
    expect(body).toContain('First line');
  });

  it('rejects entries that are not subtitles', async () => {
    const harness = await setup();
    expect((await harness.request('/__/subtitle/Show/notes.txt')).status).toBe(400);
    expect((await harness.request('/__/subtitle/Show/missing.srt')).status).toBe(404);
  });
});
