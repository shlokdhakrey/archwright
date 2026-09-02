/**
 * The site icon, inlined.
 *
 * A browser asks for `/favicon.ico` on every fresh visit unless the page names
 * an icon itself, and on Workers that request is a **billed invocation** — about
 * 20% overhead on a five-request session, spent on a 404. Declaring the icon as
 * a `data:` URI in the page means the request is never made.
 *
 * The mark is an arch: the wright's subject, and legible at 16px.
 */
const SVG = [
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>",
  "<rect width='32' height='32' rx='7' fill='#14181b'/>",
  "<path d='M9 24V15a7 7 0 0 1 14 0v9' fill='none' stroke='#5fbfa6'",
  " stroke-width='3.4' stroke-linecap='round'/>",
  '</svg>',
].join('');

/** The raw SVG, for the `/favicon.ico` fallback route. */
export const FAVICON_SVG = SVG;

/** Inline form for `<link rel="icon">`, so no separate request is made. */
export const FAVICON_DATA_URI = `data:image/svg+xml,${encodeURIComponent(SVG)}`;

/** The `<link>` tag every rendered page includes. */
export const FAVICON_LINK = `<link rel="icon" href="${FAVICON_DATA_URI}" />`;
