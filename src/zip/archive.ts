import type { RangeStream, Validators } from '../types/http.js';
import type { RangeReader } from '../types/io.js';
import type { CentralDirectory, EntryDataLocation, ZipEntry } from '../types/zip.js';
import { readCentralDirectory, type CentralDirectoryLimits } from './central-directory.js';
import { readEndOfCentralDirectory } from './eocd.js';
import { resolveEntryDataLocation } from './local-file-header.js';

/**
 * The read-facing facade over a remote ZIP. It couples a {@link RangeReader}
 * (the byte source) with a parsed {@link CentralDirectory} (the index) and
 * exposes exactly the operations the download path needs: look up an entry,
 * resolve where its data lives, and read or stream a byte range of the archive.
 *
 * It is deliberately constructible two ways — {@link ZipArchive.open} parses the
 * directory from the origin, while the public constructor rehydrates one from a
 * cached directory — so a warm cache skips all index parsing.
 */
export class ZipArchive {
  constructor(
    private readonly reader: RangeReader,
    readonly directory: CentralDirectory,
  ) {}

  static async open(
    reader: RangeReader,
    limits: CentralDirectoryLimits,
    signal?: AbortSignal,
  ): Promise<ZipArchive> {
    const eocd = await readEndOfCentralDirectory(reader, signal);
    const directory = await readCentralDirectory(reader, eocd, limits, signal);
    return new ZipArchive(reader, directory);
  }

  get validators(): Validators {
    return this.reader.validators;
  }

  get archiveSize(): number {
    return this.directory.archiveSize;
  }

  get entries(): readonly ZipEntry[] {
    return this.directory.entries;
  }

  /** Look up an entry by its normalised name. */
  getEntry(name: string): ZipEntry | undefined {
    return this.directory.index.get(name);
  }

  /** Resolve the absolute data location of an entry (reads its local header). */
  resolveData(entry: ZipEntry, signal?: AbortSignal): Promise<EntryDataLocation> {
    return resolveEntryDataLocation(this.reader, entry, signal);
  }

  /** Read a byte range of the archive into memory (used for small headers). */
  read(offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array> {
    return this.reader.read(offset, length, signal);
  }

  /** Open a streaming read of a byte range of the archive (used for entry data). */
  stream(offset: number, length: number, signal?: AbortSignal): Promise<RangeStream> {
    return this.reader.stream(offset, length, signal);
  }
}
