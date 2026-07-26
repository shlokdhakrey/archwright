import { describe, expect, it } from 'vitest';
import { HttpRangeReader } from '../../src/http/http-range-reader.js';
import { buildZip } from '../helpers/build-zip.js';
import { createMockOrigin } from '../helpers/mock-origin.js';

const OPEN = {
  timeoutMs: 5000,
  retries: 2,
  maxWholeBuffer: 1 << 26,
};

async function largeArchive(): Promise<Uint8Array> {
  // Larger than the EOCD search window so the head of the archive is out of tail.
  return buildZip([{ name: 'big.bin', data: new Uint8Array(200_000).fill(7), method: 'stored' }]);
}

describe('HttpRangeReader', () => {
  it('discovers size and validators from a single suffix probe', async () => {
    const bytes = await largeArchive();
    const origin = createMockOrigin(bytes, { etag: '"v42"' });
    const reader = await HttpRangeReader.open({ url: origin.url, fetcher: origin.fetch, ...OPEN });

    expect(reader.size).toBe(bytes.byteLength);
    expect(reader.validators.etag).toBe('"v42"');
    expect(origin.callCount()).toBe(1);
  });

  it('serves reads within the prefetched tail from memory', async () => {
    const bytes = await largeArchive();
    const origin = createMockOrigin(bytes);
    const reader = await HttpRangeReader.open({ url: origin.url, fetcher: origin.fetch, ...OPEN });

    const tail = await reader.read(reader.size - 100, 100);
    expect(tail).toEqual(bytes.subarray(bytes.byteLength - 100));
    expect(origin.callCount()).toBe(1); // no extra fetch
  });

  it('fetches ranges that fall outside the tail', async () => {
    const bytes = await largeArchive();
    const origin = createMockOrigin(bytes);
    const reader = await HttpRangeReader.open({ url: origin.url, fetcher: origin.fetch, ...OPEN });

    const head = await reader.read(0, 30);
    expect(head).toEqual(bytes.subarray(0, 30));
    expect(origin.callCount()).toBe(2);
  });

  it('retries a transient failure during open', async () => {
    const bytes = await largeArchive();
    const origin = createMockOrigin(bytes, { failTimes: 1 });
    const reader = await HttpRangeReader.open({ url: origin.url, fetcher: origin.fetch, ...OPEN });
    expect(reader.size).toBe(bytes.byteLength);
  });

  it('falls back to HEAD + absolute range when suffix ranges are unsupported', async () => {
    const bytes = await largeArchive();
    const origin = createMockOrigin(bytes, { supportsSuffixRange: false });
    const reader = await HttpRangeReader.open({ url: origin.url, fetcher: origin.fetch, ...OPEN });

    expect(reader.size).toBe(bytes.byteLength);
    expect(origin.requests.some((r) => r.method === 'HEAD')).toBe(true);
  });

  it('streams a byte range with the correct length', async () => {
    const bytes = await largeArchive();
    const origin = createMockOrigin(bytes);
    const reader = await HttpRangeReader.open({ url: origin.url, fetcher: origin.fetch, ...OPEN });

    const { body, length } = await reader.stream(1000, 500);
    expect(length).toBe(500);
    const chunks: Uint8Array[] = [];
    const streamReader = body.getReader();
    for (;;) {
      const { done, value } = await streamReader.read();
      if (done) break;
      chunks.push(value);
    }
    const total = chunks.reduce((n, c) => n + c.byteLength, 0);
    expect(total).toBe(500);
  });
});
