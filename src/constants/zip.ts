/**
 * ZIP format constants.
 *
 * References:
 *  - PKWARE APPNOTE.TXT 6.3.10 (the canonical ZIP specification)
 *  - ISO/IEC 21320-1 (Document Container File — a constrained ZIP profile)
 *
 * All multi-byte integers in a ZIP file are little-endian.
 */

/** Four-byte record signatures (little-endian uint32 as read from disk). */
export const Signature = {
  /** Local file header — `PK\x03\x04`. Precedes each entry's data. */
  LOCAL_FILE_HEADER: 0x04034b50,
  /** Data descriptor — `PK\x07\x08`. Optional trailer after streamed entries. */
  DATA_DESCRIPTOR: 0x08074b50,
  /** Central directory file header — `PK\x01\x02`. One per entry, near EOF. */
  CENTRAL_FILE_HEADER: 0x02014b50,
  /** End of central directory — `PK\x05\x06`. The archive's index anchor. */
  END_OF_CENTRAL_DIRECTORY: 0x06054b50,
  /** ZIP64 end of central directory record — `PK\x06\x06`. */
  ZIP64_END_OF_CENTRAL_DIRECTORY: 0x06064b50,
  /** ZIP64 end of central directory locator — `PK\x06\x07`. */
  ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR: 0x07064b50,
} as const;

/** Fixed (signature-inclusive) sizes of ZIP records, in bytes. */
export const RecordSize = {
  /** Local file header fixed portion (before name + extra). */
  LOCAL_FILE_HEADER: 30,
  /** Central directory file header fixed portion (before name + extra + comment). */
  CENTRAL_FILE_HEADER: 46,
  /** End of central directory fixed portion (before the variable comment). */
  END_OF_CENTRAL_DIRECTORY: 22,
  /** ZIP64 end of central directory locator (fixed size). */
  ZIP64_EOCD_LOCATOR: 20,
  /** ZIP64 end of central directory record fixed portion (v1, before extensible data). */
  ZIP64_EOCD: 56,
} as const;

/** Maximum size of the EOCD trailing comment (uint16). */
export const MAX_EOCD_COMMENT_BYTES = 0xffff;

/**
 * Upper bound on how far back from EOF the EOCD signature may live: the fixed
 * EOCD record plus a maximal comment. We fetch this window to locate the index.
 */
export const EOCD_SEARCH_WINDOW_BYTES = RecordSize.END_OF_CENTRAL_DIRECTORY + MAX_EOCD_COMMENT_BYTES;

/** Compression methods this implementation understands. */
export const CompressionMethod = {
  /** Method 0 — the bytes are stored verbatim (no compression). */
  STORED: 0,
  /** Method 8 — raw DEFLATE (RFC 1951), decoded via `DecompressionStream('deflate-raw')`. */
  DEFLATE: 8,
} as const;

export type CompressionMethodValue = (typeof CompressionMethod)[keyof typeof CompressionMethod];

/** General-purpose bit-flag masks (offset 6 of local/central headers). */
export const GeneralPurposeFlag = {
  /** Bit 0 — entry is encrypted. Unsupported (and rejected) by this Worker. */
  ENCRYPTED: 0x0001,
  /** Bit 3 — sizes/CRC are zero in the local header and live in a data descriptor. */
  DATA_DESCRIPTOR: 0x0008,
  /** Bit 6 — strong encryption. Unsupported. */
  STRONG_ENCRYPTION: 0x0040,
  /** Bit 11 — the file name and comment are UTF-8 encoded. */
  UTF8: 0x0800,
} as const;

/** Extra-field header IDs we parse. */
export const ExtraFieldId = {
  /** ZIP64 extended information extra field. */
  ZIP64: 0x0001,
  /** Info-ZIP Unicode Path extra field (0x7075) — authoritative UTF-8 name. */
  UNICODE_PATH: 0x7075,
} as const;

/** Fixed header size of a single extra field (id: uint16, size: uint16). */
export const EXTRA_FIELD_HEADER_SIZE = 4;

/**
 * Sentinel values indicating "see the ZIP64 extra field / EOCD64 for the real
 * value". A field holding one of these must be resolved from ZIP64 data.
 */
export const Zip64Sentinel = {
  UINT16: 0xffff,
  UINT32: 0xffffffff,
} as const;

/** The DOS epoch (1980-01-01) used by MS-DOS date/time fields, in ms since Unix epoch. */
export const DOS_EPOCH_MS = 315532800_000;
