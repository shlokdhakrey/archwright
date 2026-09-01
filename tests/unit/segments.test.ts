import { describe, expect, it } from 'vitest';
import {
  sliceSegments,
  streamSlices,
  totalLength,
  wholeSlices,
  type OpenSlice,
  type Segment,
} from '../../src/streaming/segments.js';
import { collectStream, readableFromBytes } from '../../src/utils/stream.js';

const encoder = new TextEncoder();

/** Two literal runs around one 10-byte "file": HDR(3) FILE(10) END(4) = 17. */
const FILE_BYTES = new Uint8Array([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
const SEGMENTS: Segment[] = [
  { kind: 'bytes', bytes: encoder.encode('HDR') },
  { kind: 'file', index: 0, length: FILE_BYTES.byteLength },
  { kind: 'bytes', bytes: encoder.encode('ENDX') },
];

const open: OpenSlice = (_index, start, length) =>
  Promise.resolve(readableFromBytes(FILE_BYTES.subarray(start, start + length)));

async function render(start: number, end: number): Promise<Uint8Array> {
  const slices = sliceSegments(SEGMENTS, start, end);
  return collectStream(streamSlices(slices, end - start + 1, open));
}

describe('segment map', () => {
  it('measures the whole archive', () => {
    expect(totalLength(SEGMENTS)).toBe(17);
  });

  it('renders the full archive from whole slices', async () => {
    const out = await collectStream(streamSlices(wholeSlices(SEGMENTS), 17, open));
    expect(out).toEqual(new Uint8Array([...encoder.encode('HDR'), ...FILE_BYTES, ...encoder.encode('ENDX')]));
  });

  it('slices inside a single literal segment', async () => {
    expect(await render(1, 2)).toEqual(encoder.encode('DR'));
  });

  it('slices inside the file payload', async () => {
    expect(await render(5, 8)).toEqual(new Uint8Array([12, 13, 14, 15]));
  });

  it('spans a boundary between literal and payload', async () => {
    expect(await render(2, 4)).toEqual(new Uint8Array([0x52, 10, 11])); // 'R', then file
  });

  it('spans all three segments', async () => {
    expect(await render(2, 14)).toEqual(
      new Uint8Array([0x52, ...FILE_BYTES, 0x45, 0x4e]), // 'R' + file + 'EN'
    );
  });

  it('serves the final byte', async () => {
    expect(await render(16, 16)).toEqual(encoder.encode('X'));
  });

  it('skips segments outside the window', () => {
    // A window entirely inside the payload touches only the file segment.
    const slices = sliceSegments(SEGMENTS, 4, 6);
    expect(slices).toHaveLength(1);
    expect(slices[0]?.segment.kind).toBe('file');
    expect(slices[0]?.offset).toBe(1);
    expect(slices[0]?.length).toBe(3);
  });

  it('reassembles byte-identically from arbitrary chunk sizes', async () => {
    const whole = await collectStream(streamSlices(wholeSlices(SEGMENTS), 17, open));
    for (const size of [1, 2, 3, 5, 7, 16, 17, 100]) {
      const parts: Uint8Array[] = [];
      for (let at = 0; at < 17; at += size) {
        parts.push(await render(at, Math.min(at + size - 1, 16)));
      }
      const joined = new Uint8Array(17);
      let offset = 0;
      for (const part of parts) {
        joined.set(part, offset);
        offset += part.byteLength;
      }
      expect(joined, `chunk size ${size}`).toEqual(whole);
    }
  });

  it('ignores zero-length segments', () => {
    const withEmpty: Segment[] = [
      { kind: 'bytes', bytes: new Uint8Array(0) },
      { kind: 'file', index: 0, length: 0 },
      ...SEGMENTS,
    ];
    expect(totalLength(withEmpty)).toBe(17);
    expect(wholeSlices(withEmpty)).toHaveLength(3);
  });
});
