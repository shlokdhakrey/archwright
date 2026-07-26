import { describe, expect, it } from 'vitest';
import { meterStream, sliceStream } from '../../src/streaming/transforms.js';
import { collectStream, readableFromBytes } from '../../src/utils/stream.js';

const encoder = new TextEncoder();

describe('sliceStream', () => {
  it('drops `skip` bytes and emits `take` bytes across chunk boundaries', async () => {
    const data = encoder.encode('0123456789ABCDEF'.repeat(64));
    const out = await collectStream(readableFromBytes(data, 7).pipeThrough(sliceStream(10, 100)));
    expect(out).toEqual(data.subarray(10, 110));
  });

  it('terminates early once the window is satisfied', async () => {
    const data = new Uint8Array(10_000).map((_, i) => i & 0xff);
    const out = await collectStream(readableFromBytes(data, 1000).pipeThrough(sliceStream(0, 5)));
    expect(out).toEqual(data.subarray(0, 5));
  });

  it('handles a skip that spans multiple whole chunks', async () => {
    const data = new Uint8Array(1000).map((_, i) => i & 0xff);
    const out = await collectStream(readableFromBytes(data, 100).pipeThrough(sliceStream(350, 50)));
    expect(out).toEqual(data.subarray(350, 400));
  });
});

describe('meterStream', () => {
  it('passes bytes through unchanged and reports the total on completion', async () => {
    const data = encoder.encode('measure me'.repeat(100));
    let total = -1;
    const out = await collectStream(
      readableFromBytes(data, 13).pipeThrough(
        meterStream((bytes) => {
          total = bytes;
        }),
      ),
    );
    expect(out).toEqual(data);
    expect(total).toBe(data.byteLength);
  });
});
