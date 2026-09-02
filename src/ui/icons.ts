/**
 * The icon set, drawn for this product rather than pulled from a library.
 *
 * Every glyph is built from the same two ideas as the logo — a semicircular
 * arch and a straight span — on a 24-unit grid with a 1.7 stroke. That shared
 * geometry is what makes them read as one family: extraction lifts a span out
 * from under an arch, bundling gathers spans into one, and the archive marks are
 * arches with their footings drawn in.
 */

const OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';

function icon(size: number, body: string, extra = ''): string {
  return `${OPEN} width="${String(size)}" height="${String(size)}"${extra}>${body}</svg>`;
}

/** The wordmark glyph: an arch on its footings. Filled, not stroked. */
export function logoMark(size = 28): string {
  return [
    `<svg viewBox="0 0 32 32" width="${String(size)}" height="${String(size)}"`,
    ' aria-hidden="true" focusable="false" fill="none">',
    '<path d="M6 27V15a10 10 0 0 1 20 0v12" stroke="currentColor" stroke-width="3.2"',
    ' stroke-linecap="round" />',
    '<path d="M3 27h26" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" />',
    '</svg>',
  ].join('');
}

/** Archive opened: an arch with a span being drawn out from beneath it. */
export function iconExtract(size = 24): string {
  return icon(
    size,
    [
      '<path d="M4 11a8 8 0 0 1 16 0v3" />',
      '<path d="M12 9v9" />',
      '<path d="m8.5 14.5 3.5 3.5 3.5-3.5" />',
      '<path d="M3 21h18" />',
    ].join(''),
  );
}

/** Spans gathered up into a single arch. */
export function iconBundle(size = 24): string {
  return icon(
    size,
    [
      '<path d="M4 20a8 8 0 0 1 16 0" />',
      '<path d="M12 15V4" />',
      '<path d="m8.5 7.5 3.5-3.5 3.5 3.5" />',
      '<path d="M6 20h12" />',
    ].join(''),
  );
}

export function iconPlay(size = 24): string {
  return icon(size, '<path d="M8 5.5v13l11-6.5-11-6.5Z" />');
}

export function iconDownload(size = 24): string {
  return icon(
    size,
    ['<path d="M12 3v12" />', '<path d="m7.5 10.5 4.5 4.5 4.5-4.5" />', '<path d="M4 21h16" />'].join(''),
  );
}

export function iconGuide(size = 24): string {
  return icon(
    size,
    [
      '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10a3 3 0 0 1 3 3v13a2.5 2.5 0 0 0-2.5-2.5H4Z" />',
      '<path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H14a3 3 0 0 0-3 3v13a2.5 2.5 0 0 1 2.5-2.5H20Z" />',
    ].join(''),
  );
}

export function iconStats(size = 24): string {
  return icon(
    size,
    ['<path d="M4 20h16" />', '<path d="M7 20v-6" />', '<path d="M12 20V7" />', '<path d="M17 20v-9" />'].join(''),
  );
}

export function iconLock(size = 24): string {
  return icon(
    size,
    [
      '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />',
      '<path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />',
    ].join(''),
  );
}

export function iconLink(size = 24): string {
  return icon(
    size,
    [
      '<path d="M10 13.5a3.5 3.5 0 0 0 5 0l3-3a3.54 3.54 0 0 0-5-5l-1.2 1.2" />',
      '<path d="M14 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.54 3.54 0 0 0 5 5l1.2-1.2" />',
    ].join(''),
  );
}

export function iconCheck(size = 24): string {
  return icon(size, '<path d="m5 12.5 4.5 4.5L19 7.5" />');
}

export function iconAlert(size = 24): string {
  return icon(
    size,
    ['<path d="M12 4.5 2.8 20h18.4L12 4.5Z" />', '<path d="M12 10v4" />', '<path d="M12 17.2v.1" />'].join(''),
  );
}

export function iconArrow(size = 24): string {
  return icon(size, ['<path d="M5 12h14" />', '<path d="m13 6 6 6-6 6" />'].join(''));
}

export function iconSun(size = 20): string {
  return icon(
    size,
    [
      '<circle cx="12" cy="12" r="4" />',
      '<path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />',
    ].join(''),
  );
}

export function iconMoon(size = 20): string {
  return icon(size, '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />');
}
