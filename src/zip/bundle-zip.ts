import { CompressionMethod } from '../constants/zip.js';
import type { BundleFile } from '../services/bundle.js';
import { closePipe, createBytePipe, pumpBody, writeChunk } from '../streaming/native-stream.js';
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

/** Opens the byte stream for the file at `index`. */
export type OpenBundleEntry = (
  index: number,
  signal?: AbortSignal,
) => Promise<ReadableStream<Uint8Array>>;

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

/** Exact output size without fetching anything. */
export function planBundleZip(files: readonly BundleFile[]): number {
  return planCombinedZip(files.map(bundleFileToEntry)).contentLength;
}

export function buildBundleZip(
  files: readonly BundleFile[],
  open: OpenBundleEntry,
  options: BuildBundleZipOptions = {},
): BundleZip {
  const plan = planCombinedZip(files.map(bundleFileToEntry));
  const pipe = createBytePipe(plan.contentLength);

  void (async () => {
    try {
      for (let index = 0; index < plan.planned.length; index++) {
        const item = plan.planned[index];
        if (!item) continue;
        await writeChunk(pipe.writable, item.localHeader);
        const body = await open(index, options.signal);
        await pumpBody(pipe.writable, body);
      }
      await writeChunk(pipe.writable, plan.centralDirectory);
      await writeChunk(pipe.writable, plan.endRecord);
      await closePipe(pipe.writable);
      options.onBytes?.(plan.contentLength);
    } catch (error) {
      await pipe.writable.abort(error).catch(() => undefined);
    }
  })();

  return {
    body: pipe.readable,
    contentLength: plan.contentLength,
    entryCount: files.length,
    zip64: plan.zip64,
  };
}
