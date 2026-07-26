import { RecordSize, Signature } from '../constants/zip.js';
import { MalformedArchiveError } from '../errors/http-error.js';
import type { EntryDataLocation, ZipEntry } from '../types/zip.js';
import type { RangeReader } from '../types/io.js';
import { ByteView } from '../utils/bytes.js';

/**
 * Resolve the absolute location of an entry's file data.
 *
 * This is the subtle, correctness-critical step: the local file header carries
 * its *own* name-length and extra-length fields, which frequently differ from
 * the central directory's (padding, alignment, differing extra fields). The data
 * therefore begins at `localHeaderOffset + 30 + LFH.nameLength + LFH.extraLength`
 * — a value that must be read from the local header itself, never inferred from
 * the central directory. Getting this wrong shifts every subsequent byte.
 */
export async function resolveEntryDataLocation(
  reader: RangeReader,
  entry: ZipEntry,
  signal?: AbortSignal,
): Promise<EntryDataLocation> {
  const headerOffset = entry.localHeaderOffset;
  if (headerOffset < 0 || headerOffset + RecordSize.LOCAL_FILE_HEADER > reader.size) {
    throw new MalformedArchiveError('local file header offset is out of bounds', { headerOffset });
  }

  const header = await reader.read(headerOffset, RecordSize.LOCAL_FILE_HEADER, signal);
  const view = new ByteView(header);
  if (view.u32(0) !== Signature.LOCAL_FILE_HEADER) {
    throw new MalformedArchiveError('invalid local file header signature', { headerOffset });
  }

  const nameLength = view.u16(26);
  const extraLength = view.u16(28);
  const dataOffset = headerOffset + RecordSize.LOCAL_FILE_HEADER + nameLength + extraLength;
  const length = entry.compressedSize;

  if (dataOffset + length > reader.size) {
    throw new MalformedArchiveError("entry data extends beyond the archive's bounds", {
      dataOffset,
      length,
      size: reader.size,
    });
  }

  return { offset: dataOffset, length };
}
