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
  /** Called with the total byte count once the body streams to completion. */
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
  const rawBody = await buildBody(archive, entry, location, satisfiable, options.signal);
  const body = options.onBytes ? rawBody.pipeThrough(meterStream(options.onBytes)) : rawBody;
  return { ...selection, body };
}

async function buildBody(
  archive: ZipArchive,
  entry: ZipEntry,
  location: EntryDataLocation,
  range: InclusiveRange | undefined,
  signal: AbortSignal | undefined,
): Promise<ReadableStream<Uint8Array>> {
  if (entry.method === ZipMethod.STORED) {
    if (range) {
      const length = range.end - range.start + 1;
      const { body } = await archive.stream(location.offset + range.start, length, signal);
      return body;
    }
    const { body } = await archive.stream(location.offset, location.length, signal);
    return body;
  }

  if (entry.method === ZipMethod.DEFLATE) {
    const { body: compressed } = await archive.stream(location.offset, location.length, signal);
    const inflated = inflateRaw(compressed);
    if (range) {
      const length = range.end - range.start + 1;
      return inflated.pipeThrough(sliceStream(range.start, length));
    }
    // Cap output at the declared size so the body can never exceed Content-Length.
    return inflated.pipeThrough(sliceStream(0, entry.uncompressedSize));
  }

  throw new UnsupportedEntryError(`compression method "${methodName(entry.method)}" is not supported`, {
    method: entry.method,
  });
}
