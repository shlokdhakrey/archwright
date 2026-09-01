import { CompressionMethod } from '../constants/zip.js';
import type { BundleFile } from '../services/bundle.js';
import {
  streamSlices,
  totalLength,
  wholeSlices,
  type OpenSlice,
  type Segment,
} from '../streaming/segments.js';
import type { ZipEntry } from '../types/zip.js';
import { planCombinedZip } from './zip-writer.js';

/**
 * Build a ZIP from arbitrary remote files (the "bundle" direction), reusing the
 * archive writer's layout planner — including its ZIP64 promotions and exact
 * `Content-Length` — by describing each remote file as a synthetic STORED entry.
 *
 * STORED is the right method here: bundles are usually already-compressed media,
 * where DEFLATE would burn CPU for no gain, and storing verbatim lets every
 * payload move natively via `pipeTo`.
 *
 * Every file's CRC-32 must already be known (cached on the manifest). That is
 * what keeps this path free of per-byte JS work — and it is why ZIP, unlike TAR,
 * needs a one-time prepare pass.
 */

const encoder = new TextEncoder();

/** Describe a bundle file as a STORED ZIP entry the planner understands. */
export function bundleFileToEntry(file: BundleFile): ZipEntry {
  return {
    name: file.name,
    rawName: encoder.encode(file.name),
    method: CompressionMethod.STORED,
    compressedSize: file.size,
    uncompressedSize: file.size,
    crc32: file.crc32 ?? 0,
    localHeaderOffset: 0,
    flags: 0,
    isDirectory: false,
    isEncrypted: false,
    hasDataDescriptor: false,
    lastModified: file.lastModified ?? 0,
  };
}

export interface BundleZip {
  readonly body: ReadableStream<Uint8Array>;
  readonly contentLength: number;
  readonly entryCount: number;
  readonly zip64: boolean;
}

export interface BuildBundleZipOptions {
  readonly signal?: AbortSignal;
  readonly onBytes?: (bytes: number) => void;
}

/**
 * The archive as an addressable byte map: local header then payload per file,
 * then the central directory and end record. This is what makes a generated ZIP
 * seekable — and it is only possible because every CRC-32 is already known.
 */
export function bundleZipSegments(files: readonly BundleFile[]): {
  segments: Segment[];
  contentLength: number;
  zip64: boolean;
} {
  const plan = planCombinedZip(files.map(bundleFileToEntry));
  const segments: Segment[] = [];
  plan.planned.forEach((item, index) => {
    segments.push({ kind: 'bytes', bytes: item.localHeader });
    if (item.entry.compressedSize > 0) {
      segments.push({ kind: 'file', index, length: item.entry.compressedSize });
    }
  });
  segments.push({ kind: 'bytes', bytes: plan.centralDirectory });
  segments.push({ kind: 'bytes', bytes: plan.endRecord });
  return { segments, contentLength: plan.contentLength, zip64: plan.zip64 };
}

/** Exact output size without fetching anything. */
export function planBundleZip(files: readonly BundleFile[]): number {
  return planCombinedZip(files.map(bundleFileToEntry)).contentLength;
}

export function buildBundleZip(
  files: readonly BundleFile[],
  open: OpenSlice,
  options: BuildBundleZipOptions = {},
): BundleZip {
  const { segments, contentLength, zip64 } = bundleZipSegments(files);
  return {
    body: streamSlices(wholeSlices(segments), totalLength(segments), open, options),
    contentLength,
    entryCount: files.length,
    zip64,
  };
}
