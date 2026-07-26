/** Format an unsigned 32-bit integer as fixed-width, zero-padded lower-case hex. */
export function uint32ToHex(value: number): string {
  return (value >>> 0).toString(16).padStart(8, '0');
}
