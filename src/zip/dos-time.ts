import { DOS_EPOCH_MS } from '../constants/zip.js';

/**
 * Convert the MS-DOS date/time pair stored in a ZIP header to milliseconds since
 * the Unix epoch. DOS timestamps are local time with 2-second resolution and no
 * timezone; we interpret them as UTC, which is the conventional, lossless-enough
 * choice for `Last-Modified`. Invalid encodings fall back to the DOS epoch.
 */
export function dosDateTimeToEpochMs(dosTime: number, dosDate: number): number {
  const seconds = (dosTime & 0x1f) * 2;
  const minutes = (dosTime >> 5) & 0x3f;
  const hours = (dosTime >> 11) & 0x1f;

  const day = dosDate & 0x1f;
  const month = (dosDate >> 5) & 0x0f;
  const year = ((dosDate >> 9) & 0x7f) + 1980;

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return DOS_EPOCH_MS;
  }

  const ms = Date.UTC(year, month - 1, day, hours, minutes, seconds);
  return Number.isFinite(ms) ? ms : DOS_EPOCH_MS;
}

/**
 * Encode a millisecond epoch back into an MS-DOS date/time pair, for writing ZIP
 * headers. Values are clamped to the representable DOS range (1980–2107).
 */
export function epochMsToDosDateTime(ms: number): { time: number; date: number } {
  const d = new Date(ms);
  const year = d.getUTCFullYear();
  if (!Number.isFinite(ms) || year < 1980) {
    return { time: 0, date: 0x21 }; // 1980-01-01T00:00:00
  }
  const clampedYear = Math.min(year, 2107);
  const date = (((clampedYear - 1980) & 0x7f) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1);
  return { time, date };
}
