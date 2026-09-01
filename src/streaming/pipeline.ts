import { Status } from '../constants/http.js';
import { CompressionMethod as ZipMethod } from '../constants/zip.js';
import { UnsupportedEntryError } from '../errors/http-error.js';
import { formatContentRange } from '../http/range.js';
import type { InclusiveRange, RangeParseResult } from '../types/http.js';
import type { EntryDataLocation, ZipEntry } from '../types/zip.js';
import type { ZipArchive } from '../zip/archive.js';
import { methodName } from '../zip/method.js';
import { inflateRaw } from './inflate.js';
import { meterStream, sliceStream } from './transforms.js';

const { OK, PARTIAL_CONTENT } = Status;

/** How a request's range maps onto status, length and Content-Range. */
export interface Selection {
  readonly status: typeof OK | typeof PARTIAL_CONTENT;
  readonly contentLength: number;
  readonly contentRange?: string;
}

/**
 * The single source of truth mapping an (entry, range) pair to response
 * metadata. Both the GET body pipeline and the HEAD path derive their status,
 * `Content-Length` and `Content-Range` from here, so they can never disagree.
 */
export function selectionFor(entry: ZipEntry, range: RangeParseResult): Selection {
  if (range.kind === 'satisfiable') {
    const { start, end } = range.range;
    return {
      status: PARTIAL_CONTENT,
      contentLength: end - start + 1,
      contentRange: formatContentRange(start, end, entry.uncompressedSize),
    };
  }
  return { status: OK, contentLength: entry.uncompressedSize };
}

/** A ready-to-serve body plan for an entry. */
export interface EntryStreamPlan extends Selection {
  readonly body: ReadableStream<Uint8Array>;
}

export interface BuildStreamOptions {
  /**
   * Reports the entry's byte count. For a transformed body (DEFLATE) this fires
   * when the stream completes; for a zero-copy passthrough (STORED) it fires up
   * front with the planned length, because metering it would mean routing every
   * byte through the isolate.
   */
  readonly onBytes?: (bytes: number) => void;
  /** Propagated to the origin read; a client disconnect cancels it. */
  readonly signal?: AbortSignal;
}

/**
 * Assemble the response body for an entry, given an optional satisfied range.
 *
 *  - **STORED** maps directly onto the origin: a full read is a pass-through, and
 *    a range is served by shifting the origin offset — true random access, ideal
 *    for media seeking.
 *  - **DEFLATE** is inflated natively. A full read is length-capped to the
 *    declared uncompressed size; a range inflates from the start and slices out
 *    the requested window (sequential-access cost, documented in the API).
 *
 * In every case the body is a lazily-pulled stream: memory stays constant and
 * independent of entry size.
 */
export async function buildEntryStream(
  archive: ZipArchive,
  entry: ZipEntry,
  location: EntryDataLocation,
  range: RangeParseResult,
  options: BuildStreamOptions = {},
): Promise<EntryStreamPlan> {
  const selection = selectionFor(entry, range);
  const satisfiable = range.kind === 'satisfiable' ? range.range : undefined;
  const built = await buildBody(archive, entry, location, satisfiable, options.signal);

  // A STORED read is the origin stream verbatim. Wrapping it in a metering
  // TransformStream would drag every byte through the JS isolate (~17 ms of CPU
  // per MB) — the difference between an unlimited download and one that dies at
  // ~115 MB. Keep it zero-copy and report the planned length instead.
  if (built.passthrough) {
    options.onBytes?.(selection.contentLength);
    return { ...selection, body: built.body };
  }

  const body = options.onBytes ? built.body.pipeThrough(meterStream(options.onBytes)) : built.body;
  return { ...selection, body };
}

interface BuiltBody {
  readonly body: ReadableStream<Uint8Array>;
  /** True when the body is the origin stream untouched (no JS transform). */
  readonly passthrough: boolean;
}

async function buildBody(
  archive: ZipArchive,
  entry: ZipEntry,
  location: EntryDataLocation,
  range: InclusiveRange | undefined,
  signal: AbortSignal | undefined,
): Promise<BuiltBody> {
  if (entry.method === ZipMethod.STORED) {
    if (range) {
      const length = range.end - range.start + 1;
      const { body } = await archive.stream(location.offset + range.start, length, signal);
      return { body, passthrough: true };
    }
    const { body } = await archive.stream(location.offset, location.length, signal);
    return { body, passthrough: true };
  }

  if (entry.method === ZipMethod.DEFLATE) {
    const { body: compressed } = await archive.stream(location.offset, location.length, signal);
    const inflated = inflateRaw(compressed);
    if (range) {
      const length = range.end - range.start + 1;
      return { body: inflated.pipeThrough(sliceStream(range.start, length)), passthrough: false };
    }
    // Cap output at the declared size so the body can never exceed Content-Length.
    return { body: inflated.pipeThrough(sliceStream(0, entry.uncompressedSize)), passthrough: false };
  }

  throw new UnsupportedEntryError(`compression method "${methodName(entry.method)}" is not supported`, {
    method: entry.method,
  });
}
