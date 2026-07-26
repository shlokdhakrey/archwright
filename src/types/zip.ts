/** Parsed ZIP domain types. All are plain, immutable data. */

/** A single entry as described by the central directory. */
export interface ZipEntry {
  /** Decoded, forward-slash-normalised name used for display and lookup. */
  readonly name: string;
  /** Exact name bytes from the central directory (for diagnostics / exact match). */
  readonly rawName: Uint8Array;
  /** Compression method (0 = STORED, 8 = DEFLATE; others are listed but not served). */
  readonly method: number;
  /** Size of the entry's data as stored in the archive. */
  readonly compressedSize: number;
  /** Size of the entry's data once decompressed. */
  readonly uncompressedSize: number;
  /** CRC-32 of the uncompressed data, unsigned. */
  readonly crc32: number;
  /** Absolute offset of the entry's local file header. */
  readonly localHeaderOffset: number;
  /** General-purpose bit flags (offset 8 of the central header). */
  readonly flags: number;
  /** True when the name denotes a directory (trailing slash / zero size marker). */
  readonly isDirectory: boolean;
  /** True when the entry is (weak or strong) encrypted; such entries are rejected. */
  readonly isEncrypted: boolean;
  /** True when sizes/CRC live in a trailing data descriptor. */
  readonly hasDataDescriptor: boolean;
  /** Last-modified time in ms since the Unix epoch (from the DOS date/time fields). */
  readonly lastModified: number;
}

/** Result of locating and interpreting the end-of-central-directory records. */
export interface EndOfCentralDirectory {
  readonly centralDirectoryOffset: number;
  readonly centralDirectorySize: number;
  readonly entryCount: number;
  readonly isZip64: boolean;
}

/** The parsed central directory: the archive's index. */
export interface CentralDirectory {
  readonly entries: readonly ZipEntry[];
  /** Normalised name → entry, for O(1) lookup. */
  readonly index: ReadonlyMap<string, ZipEntry>;
  readonly isZip64: boolean;
  /** Total size of the archive in bytes. */
  readonly archiveSize: number;
}

/** Absolute location of an entry's file data (after the local header). */
export interface EntryDataLocation {
  readonly offset: number;
  readonly length: number;
}
