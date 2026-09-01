import { closePipe, createBytePipe, pumpBody, writeChunk } from './native-stream.js';

/**
 * Archives as addressable byte maps.
 *
 * Once every entry's size (and, for ZIP, its CRC-32) is known, the output is a
 * pure function of position: header bytes, then payload, then padding, then the
 * trailing index — all at fixed offsets. Describing that as a list of segments
 * makes a generated archive **seekable**, which is what unlocks `Range`:
 *
 *  - interrupted multi-gigabyte downloads resume instead of restarting;
 *  - download managers, which fetch by range, work at all;
 *  - each range is a separate invocation with its own CPU budget, so a client
 *    pulling chunks sidesteps the per-request ceiling entirely.
 *
 * This is the same bargain nginx's `mod_zip` strikes: supply checksums up front
 * and you get Range support; omit them and you don't.
 */

/** A run of bytes in the output: either literal (headers) or a file's payload. */
export type Segment =
  | { readonly kind: 'bytes'; readonly bytes: Uint8Array }
  | { readonly kind: 'file'; readonly index: number; readonly length: number };

/** The part of a segment that a requested range actually covers. */
export interface SegmentSlice {
  readonly segment: Segment;
  /** Offset of the first needed byte *within* the segment. */
  readonly offset: number;
  readonly length: number;
}

/** Byte length of one segment. */
export function segmentLength(segment: Segment): number {
  return segment.kind === 'bytes' ? segment.bytes.byteLength : segment.length;
}

/** Total size of the archive described by `segments`. */
export function totalLength(segments: readonly Segment[]): number {
  let total = 0;
  for (const segment of segments) total += segmentLength(segment);
  return total;
}

/** Every segment, whole — the slice list for a full (non-Range) download. */
export function wholeSlices(segments: readonly Segment[]): SegmentSlice[] {
  return segments
    .filter((segment) => segmentLength(segment) > 0)
    .map((segment) => ({ segment, offset: 0, length: segmentLength(segment) }));
}

/**
 * The slices covering `[start, end]` (inclusive), skipping segments outside it
 * and trimming the two at the boundaries.
 */
export function sliceSegments(
  segments: readonly Segment[],
  start: number,
  end: number,
): SegmentSlice[] {
  const slices: SegmentSlice[] = [];
  let position = 0;

  for (const segment of segments) {
    const size = segmentLength(segment);
    if (size === 0) continue;
    const segmentEnd = position + size - 1;

    if (segmentEnd >= start && position <= end) {
      const from = Math.max(start - position, 0);
      const to = Math.min(end - position, size - 1);
      slices.push({ segment, offset: from, length: to - from + 1 });
    }

    position += size;
    if (position > end) break;
  }

  return slices;
}

/** Opens `length` bytes of the file at `index`, starting `start` bytes in. */
export type OpenSlice = (
  index: number,
  start: number,
  length: number,
  signal?: AbortSignal,
) => Promise<ReadableStream<Uint8Array>>;

export interface StreamSlicesOptions {
  readonly signal?: AbortSignal;
  readonly onBytes?: (bytes: number) => void;
}

/**
 * Stream the given slices as one body. Literal bytes are written from JS (they
 * are tiny); file payloads are moved with `pipeTo` into a native pipe, so they
 * never enter the isolate regardless of size.
 */
export function streamSlices(
  slices: readonly SegmentSlice[],
  contentLength: number,
  open: OpenSlice,
  options: StreamSlicesOptions = {},
): ReadableStream<Uint8Array> {
  const pipe = createBytePipe(contentLength);

  // Detached writer: the response body keeps the Worker alive while the client
  // drains it, so this runs to completion as the bytes are consumed.
  void (async () => {
    try {
      for (const slice of slices) {
        if (slice.length === 0) continue;
        if (slice.segment.kind === 'bytes') {
          await writeChunk(
            pipe.writable,
            slice.segment.bytes.subarray(slice.offset, slice.offset + slice.length),
          );
        } else {
          const body = await open(slice.segment.index, slice.offset, slice.length, options.signal);
          await pumpBody(pipe.writable, body);
        }
      }
      await closePipe(pipe.writable);
      options.onBytes?.(contentLength);
    } catch (error) {
      // A client disconnect lands here too; aborting cancels the origin fetch.
      await pipe.writable.abort(error).catch(() => undefined);
    }
  })();

  return pipe.readable;
}
