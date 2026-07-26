import type { DispositionMode } from '../types/config.js';

/**
 * Build a safe `Content-Disposition` header value.
 *
 * The filename is taken from the entry's base name and defended on two fronts:
 *  - Header injection: all control characters (including CR/LF) are stripped.
 *  - Non-ASCII names: an ASCII fallback (`filename="…"`) is paired with an
 *    RFC 5987 `filename*=UTF-8''…` parameter so modern clients recover the exact
 *    Unicode name while legacy clients still get a usable name.
 */
export function contentDisposition(mode: DispositionMode, name: string): string {
  const base = baseName(name);
  const asciiFallback = toAsciiFallback(base);
  const encoded = encodeRfc5987(base);
  return `${mode}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

function baseName(name: string): string {
  const withoutTrailingSlash = name.endsWith('/') ? name.slice(0, -1) : name;
  const slash = withoutTrailingSlash.lastIndexOf('/');
  const base = slash >= 0 ? withoutTrailingSlash.slice(slash + 1) : withoutTrailingSlash;
  return base.length > 0 ? base : 'download';
}

/** Replace control chars, quotes, backslashes and non-ASCII with `_`. */
function toAsciiFallback(value: string): string {
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f || char === '"' || char === '\\' || code > 0x7e) {
      out += '_';
    } else {
      out += char;
    }
  }
  return out.length > 0 ? out : 'download';
}

/** Percent-encode per RFC 5987 (`attr-char` set kept literal). */
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value)
    .replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%(7C|60|5E)/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}
