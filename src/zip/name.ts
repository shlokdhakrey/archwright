import { GeneralPurposeFlag } from '../constants/zip.js';
import { decodeCp437 } from './cp437.js';

const utf8Decoder = new TextDecoder('utf-8');

/**
 * Decode a ZIP entry name to a normalised JavaScript string.
 *
 * Encoding is chosen per the spec: an explicit Unicode Path extra field wins,
 * then the UTF-8 general-purpose flag (bit 11), otherwise CP437. The result is
 * normalised — backslashes folded to `/`, Unicode NFC — so that lookups are
 * stable and a name cannot smuggle two representations of the same path.
 */
export function decodeEntryName(rawName: Uint8Array, flags: number, unicodeOverride?: string): string {
  if (unicodeOverride !== undefined) return normaliseName(unicodeOverride);
  const useUtf8 = (flags & GeneralPurposeFlag.UTF8) !== 0;
  const decoded = useUtf8 ? utf8Decoder.decode(rawName) : decodeCp437(rawName);
  return normaliseName(decoded);
}

/** Fold path separators and apply Unicode NFC normalisation. */
export function normaliseName(name: string): string {
  return name.replace(/\\/g, '/').normalize('NFC');
}

/** True when a raw name ends in a path separator (a directory marker). */
export function isDirectoryName(rawName: Uint8Array): boolean {
  return rawName.byteLength > 0 && rawName[rawName.byteLength - 1] === 0x2f;
}
