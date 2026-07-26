/**
 * Header-value hygiene. Rather than embed literal control bytes in a regex, we
 * test code points numerically: any C0 control (0x00–0x1F, includes CR/LF/NUL)
 * or DEL (0x7F) is unsafe in an HTTP header value and could enable header
 * splitting/injection.
 */

function isControlCodePoint(code: number): boolean {
  return code <= 0x1f || code === 0x7f;
}

/** Strip control characters from a string destined for a response header. */
export function sanitizeHeaderValue(value: string): string {
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (!isControlCodePoint(code)) out += char;
  }
  return out.trim();
}

/** True when a string contains a character that is unsafe in a header value. */
export function hasControlCharacters(value: string): boolean {
  for (const char of value) {
    if (isControlCodePoint(char.codePointAt(0) ?? 0)) return true;
  }
  return false;
}
