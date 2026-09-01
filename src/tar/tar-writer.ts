import {
  streamSlices,
  totalLength,
  wholeSlices,
  type OpenSlice,
  type Segment,
} from '../streaming/segments.js';

/**
 * Streaming TAR (POSIX ustar) writer.
 *
 * TAR is the format of choice for bundling *arbitrary* remote files because,
 * unlike ZIP, it stores **no checksum of file content** — only the 512-byte
 * header is checksummed. A bundle can therefore be assembled without ever
 * looking at a payload byte: headers are written from JS, bodies are moved with
 * `pipeTo` into a native pipe, and the Worker's CPU cost stays flat no matter
 * how many gigabytes flow through. (ZIP needs a CRC-32 per entry, which forces
 * every byte through the isolate at ~10 ms/MB unless the checksum is known.)
 *
 * Layout: per file a 512-byte header, the content padded up to a 512-byte
 * boundary, then a 1024-byte zero trailer. Every size is known in advance, so
 * the exact `Content-Length` is computed before a byte is sent.
 */

const BLOCK = 512;
/** Two zero blocks mark end-of-archive. */
const TRAILER_BLOCKS = 2;
/** Largest size expressible in 11 octal digits; past this, use base-256. */
const MAX_OCTAL_SIZE = 0o77777777777;
const NAME_FIELD = 100;
const PREFIX_FIELD = 155;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** One file to place in the archive. */
export interface TarFile {
  readonly name: string;
  readonly size: number;
  /** Epoch milliseconds; defaults to 0 so output stays deterministic. */
  readonly lastModified?: number;
}

interface PlannedTarEntry {
  readonly file: TarFile;
  /** Header block(s): an optional PAX extended header, then the file header. */
  readonly header: Uint8Array;
  /** Zero padding after the content, up to the next 512-byte boundary. */
  readonly padding: number;
}

export interface TarPlan {
  readonly planned: readonly PlannedTarEntry[];
  readonly contentLength: number;
}

export interface TarArchive {
  readonly body: ReadableStream<Uint8Array>;
  readonly contentLength: number;
  readonly entryCount: number;
}

export interface BuildTarOptions {
  readonly signal?: AbortSignal;
  readonly onBytes?: (bytes: number) => void;
}

/**
 * Compute the exact byte layout without touching any data. Pure and
 * deterministic, so it is unit-tested directly and yields `Content-Length`.
 */
export function planTar(files: readonly TarFile[]): TarPlan {
  const planned: PlannedTarEntry[] = [];
  let total = 0;

  for (const file of files) {
    const header = buildHeaderBlocks(file);
    const padding = (BLOCK - (file.size % BLOCK)) % BLOCK;
    planned.push({ file, header, padding });
    total += header.byteLength + file.size + padding;
  }

  return { planned, contentLength: total + TRAILER_BLOCKS * BLOCK };
}

/**
 * The archive as an addressable byte map: header, payload and padding per file,
 * then the zero trailer. Exposing this is what makes a generated TAR seekable —
 * see `streaming/segments.ts`.
 */
export function tarSegments(plan: TarPlan): Segment[] {
  const segments: Segment[] = [];
  plan.planned.forEach((item, index) => {
    segments.push({ kind: 'bytes', bytes: item.header });
    if (item.file.size > 0) {
      segments.push({ kind: 'file', index, length: item.file.size });
    }
    if (item.padding > 0) {
      segments.push({ kind: 'bytes', bytes: new Uint8Array(item.padding) });
    }
  });
  segments.push({ kind: 'bytes', bytes: new Uint8Array(TRAILER_BLOCKS * BLOCK) });
  return segments;
}

/**
 * Build the streaming TAR. Payloads are moved natively — they never enter the
 * JS isolate — so CPU cost is independent of archive size.
 */
export function buildTar(
  files: readonly TarFile[],
  open: OpenSlice,
  options: BuildTarOptions = {},
): TarArchive {
  const plan = planTar(files);
  const segments = tarSegments(plan);
  return {
    body: streamSlices(wholeSlices(segments), totalLength(segments), open, options),
    contentLength: plan.contentLength,
    entryCount: files.length,
  };
}

// --- header construction -----------------------------------------------------

/**
 * Header block(s) for one file: a PAX extended header first when the name will
 * not fit the ustar name/prefix fields.
 */
function buildHeaderBlocks(file: TarFile): Uint8Array {
  const nameBytes = encoder.encode(file.name);
  const split = splitName(nameBytes);
  if (split) {
    return buildUstarHeader(file, split.name, split.prefix, '0');
  }

  // Long name: emit a PAX record carrying the real path, then a ustar header
  // with a truncated fallback so legacy readers still see something sensible.
  const pax = paxRecord('path', file.name);
  const paxName = `PaxHeader/${truncateName(nameBytes)}`;
  const paxSplit = splitName(encoder.encode(paxName));
  const paxHeader = buildUstarHeader(
    { name: paxName, size: pax.byteLength },
    paxSplit ? paxSplit.name : truncateName(encoder.encode(paxName)),
    paxSplit ? paxSplit.prefix : '',
    'x',
  );
  const paxPadding = (BLOCK - (pax.byteLength % BLOCK)) % BLOCK;
  const fileHeader = buildUstarHeader(file, truncateName(nameBytes), '', '0');

  const out = new Uint8Array(
    paxHeader.byteLength + pax.byteLength + paxPadding + fileHeader.byteLength,
  );
  let at = 0;
  out.set(paxHeader, at);
  at += paxHeader.byteLength;
  out.set(pax, at);
  at += pax.byteLength + paxPadding;
  out.set(fileHeader, at);
  return out;
}

/** Fit a name into ustar name(100)/prefix(155), or return null if impossible. */
function splitName(nameBytes: Uint8Array): { name: string; prefix: string } | null {
  if (nameBytes.byteLength <= NAME_FIELD) {
    return { name: decoder.decode(nameBytes), prefix: '' };
  }
  for (let i = 0; i < nameBytes.byteLength; i++) {
    if (nameBytes[i] !== 0x2f) continue; // '/'
    const prefixLength = i;
    const restLength = nameBytes.byteLength - i - 1;
    if (prefixLength <= PREFIX_FIELD && restLength <= NAME_FIELD && restLength > 0) {
      return {
        name: decoder.decode(nameBytes.subarray(i + 1)),
        prefix: decoder.decode(nameBytes.subarray(0, i)),
      };
    }
  }
  return null;
}

function truncateName(nameBytes: Uint8Array): string {
  return decoder.decode(nameBytes.subarray(0, NAME_FIELD));
}

/** A PAX record: "<len> <key>=<value>\n", where len counts its own digits. */
function paxRecord(key: string, value: string): Uint8Array {
  const body = `${key}=${value}\n`;
  let length = encoder.encode(body).byteLength + 2;
  for (;;) {
    const encoded = encoder.encode(`${length} ${body}`);
    if (encoded.byteLength === length) return encoded;
    length = encoded.byteLength;
  }
}

function buildUstarHeader(
  file: TarFile,
  name: string,
  prefix: string,
  typeflag: string,
): Uint8Array {
  const header = new Uint8Array(BLOCK);
  putString(header, 0, name, NAME_FIELD);
  putOctal(header, 100, 0o644, 8); // mode
  putOctal(header, 108, 0, 8); // uid
  putOctal(header, 116, 0, 8); // gid
  putSize(header, 124, file.size);
  putOctal(header, 136, Math.floor((file.lastModified ?? 0) / 1000), 12); // mtime
  // The checksum field counts as 8 spaces while the sum is computed.
  header.fill(0x20, 148, 156);
  putString(header, 156, typeflag, 1);
  putString(header, 257, 'ustar', 5);
  header[262] = 0x00;
  putString(header, 263, '00', 2);
  putString(header, 265, 'root', 32); // uname
  putString(header, 297, 'root', 32); // gname
  putString(header, 345, prefix, PREFIX_FIELD);

  let sum = 0;
  for (const byte of header) sum += byte;
  // Six octal digits, NUL, then space — the most widely accepted encoding.
  putString(header, 148, sum.toString(8).padStart(6, '0'), 6);
  header[154] = 0x00;
  header[155] = 0x20;

  return header;
}

function putString(buffer: Uint8Array, offset: number, value: string, length: number): void {
  buffer.set(encoder.encode(value).subarray(0, length), offset);
}

function putOctal(buffer: Uint8Array, offset: number, value: number, length: number): void {
  putString(buffer, offset, value.toString(8).padStart(length - 1, '0'), length - 1);
  buffer[offset + length - 1] = 0x00;
}

/**
 * Write the size field. Sizes past 8 GiB do not fit 11 octal digits, so fall
 * back to the base-256 encoding (high bit set, then big-endian) understood by
 * GNU tar, libarchive/bsdtar (including Windows' built-in tar) and 7-Zip.
 */
function putSize(buffer: Uint8Array, offset: number, size: number): void {
  if (size <= MAX_OCTAL_SIZE) {
    putOctal(buffer, offset, size, 12);
    return;
  }
  buffer[offset] = 0x80;
  let remaining = BigInt(size);
  for (let i = offset + 11; i > offset; i--) {
    buffer[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
}
