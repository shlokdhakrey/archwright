import { describe, expect, it } from 'vitest';
import { buildTar, planTar, type TarFile } from '../../src/tar/tar-writer.js';
import { collectStream, readableFromBytes } from '../../src/utils/stream.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytes(length: number, seed: number): Uint8Array {
  return new Uint8Array(length).map((_, i) => (i * seed + 7) & 0xff);
}

/** Read a NUL/space-terminated ustar text field. */
function field(block: Uint8Array, offset: number, length: number): string {
  const raw = block.subarray(offset, offset + length);
  let end = raw.indexOf(0);
  if (end === -1) end = raw.length;
  return decoder.decode(raw.subarray(0, end)).trim();
}

/** Recompute the header checksum the way a tar reader does. */
function checksumOf(block: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < 512; i++) {
    sum += i >= 148 && i < 156 ? 0x20 : (block[i] ?? 0);
  }
  return sum;
}

async function build(files: TarFile[], data: Uint8Array[]): Promise<Uint8Array> {
  const tar = buildTar(files, (i) => Promise.resolve(readableFromBytes(data[i]!)));
  const out = await collectStream(tar.body);
  expect(out.byteLength).toBe(tar.contentLength);
  return out;
}

describe('tar writer', () => {
  it('plans the exact content length and emits it', async () => {
    const files: TarFile[] = [
      { name: 'a.bin', size: 100 },
      { name: 'dir/b.bin', size: 512 },
      { name: 'c.bin', size: 1000 },
    ];
    const data = [bytes(100, 3), bytes(512, 5), bytes(1000, 11)];
    const out = await build(files, data);

    // header+padded content per file, plus a 1024-byte trailer.
    const expected = 512 + 512 + (512 + 512) + (512 + 1024) + 1024;
    expect(planTar(files).contentLength).toBe(expected);
    expect(out.byteLength).toBe(expected);
  });

  it('writes valid ustar headers with correct name, size and checksum', async () => {
    const files: TarFile[] = [{ name: 'movie.mkv', size: 300 }];
    const out = await build(files, [bytes(300, 13)]);
    const header = out.subarray(0, 512);

    expect(field(header, 0, 100)).toBe('movie.mkv');
    expect(field(header, 257, 6)).toBe('ustar');
    expect(field(header, 156, 1)).toBe('0'); // regular file
    expect(parseInt(field(header, 124, 12), 8)).toBe(300); // size, octal
    expect(parseInt(field(header, 148, 8), 8)).toBe(checksumOf(header));
  });

  it('places content at the right offset and zero-pads to 512', async () => {
    const first = bytes(100, 3);
    const second = bytes(700, 17);
    const out = await build(
      [
        { name: 'a.bin', size: 100 },
        { name: 'b.bin', size: 700 },
      ],
      [first, second],
    );

    expect(out.subarray(512, 612)).toEqual(first);
    // Remainder of the first block is zero padding.
    expect(out.subarray(612, 1024).every((b) => b === 0)).toBe(true);
    // Second file: header at 1024, content at 1536, spanning two blocks.
    expect(field(out.subarray(1024, 1536), 0, 100)).toBe('b.bin');
    expect(out.subarray(1536, 2236)).toEqual(second);
    expect(out.subarray(2236, 2560).every((b) => b === 0)).toBe(true);
  });

  it('ends with the 1024-byte zero trailer', async () => {
    const out = await build([{ name: 'a.bin', size: 10 }], [bytes(10, 3)]);
    expect(out.subarray(out.byteLength - 1024).every((b) => b === 0)).toBe(true);
  });

  it('splits a long path across the prefix and name fields', async () => {
    const dir = 'nested'.padEnd(120, 'x');
    const name = `${dir}/file.mkv`;
    const out = await build([{ name, size: 10 }], [bytes(10, 3)]);
    const header = out.subarray(0, 512);
    expect(field(header, 0, 100)).toBe('file.mkv');
    expect(field(header, 345, 155)).toBe(dir);
  });

  it('emits a PAX extended header when the name cannot fit ustar fields', async () => {
    const name = `${'v'.repeat(200)}.mkv`; // no separator, too long for either field
    const out = await build([{ name, size: 10 }], [bytes(10, 3)]);
    const paxHeader = out.subarray(0, 512);
    expect(field(paxHeader, 156, 1)).toBe('x'); // PAX extended header type
    const paxSize = parseInt(field(paxHeader, 124, 12), 8);
    const record = decoder.decode(out.subarray(512, 512 + paxSize));
    expect(record).toContain(`path=${name}`);
    // The record announces its own total length.
    expect(parseInt(record.split(' ')[0]!, 10)).toBe(encoder.encode(record).byteLength);
  });

  it('uses base-256 for sizes beyond the 8 GiB octal limit', () => {
    const huge = 20_000_000_000; // ~18.6 GiB
    const plan = planTar([{ name: 'big.mkv', size: huge }]);
    const header = plan.planned[0]?.header ?? new Uint8Array();
    expect(header[124]).toBe(0x80); // base-256 marker
    let value = 0n;
    for (let i = 125; i < 136; i++) value = (value << 8n) | BigInt(header[i] ?? 0);
    expect(Number(value)).toBe(huge);
    // Layout still accounts for the real size.
    const padding = (512 - (huge % 512)) % 512;
    expect(plan.contentLength).toBe(512 + huge + padding + 1024);
  });
});
