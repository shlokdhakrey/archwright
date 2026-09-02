import { iconBundle, iconExtract } from '../icons.js';
import { renderPage } from '../layout.js';

/**
 * The 404.
 *
 * Drawn as an arch missing its keystone — the one piece whose absence stops the
 * whole span from carrying. It reuses the hero's geometry so the page still
 * feels like part of the product rather than a server default, and it offers
 * the two things a lost visitor actually wants rather than a bare apology.
 */

const BROKEN_ARCH = [
  '<svg class="art" viewBox="0 0 320 200" role="img" aria-label="An arch missing its keystone">',
  // Left haunch.
  '<path d="M60 168V116a100 100 0 0 1 34-75" fill="none" stroke="currentColor"',
  ' stroke-width="10" stroke-linecap="round" />',
  // Right haunch.
  '<path d="M260 168V116a100 100 0 0 0-34-75" fill="none" stroke="currentColor"',
  ' stroke-width="10" stroke-linecap="round" />',
  // The absent keystone.
  '<path d="M112 30a100 100 0 0 1 96 0" fill="none" stroke="currentColor" stroke-width="10"',
  ' stroke-linecap="round" stroke-dasharray="3 17" opacity="0.4" />',
  '<path d="M36 168h248" fill="none" stroke="currentColor" stroke-width="10"',
  ' stroke-linecap="round" />',
  '</svg>',
].join('');

const CSS = `
.lost { padding: 72px 0 40px; text-align: center; display: grid; gap: 22px; justify-items: center; }
.lost .art { width: min(300px, 70vw); height: auto; color: var(--accent); }
.lost h1 { font-size: clamp(34px, 5.4vw, 52px); }
.lost .code {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 13px; letter-spacing: 0.2em; color: var(--ink-faint);
}
.lost .lede { text-align: center; }
.lost .reasons { margin-top: 10px; padding: 22px 26px; text-align: left; max-width: 520px; }
.lost .reasons h2 { font-size: 15px; margin-bottom: 10px; }
.lost .reasons ul { margin: 0; padding-left: 18px; color: var(--ink-soft); font-size: 15px; }
.lost .reasons li { margin-bottom: 7px; }
.lost .reasons li::marker { color: var(--accent); }
`;

const BODY = `
<section class="shell narrow lost">
  ${BROKEN_ARCH}
  <p class="code">404 — NOT FOUND</p>
  <h1>That link does not lead anywhere</h1>
  <p class="lede">The page or archive you asked for is not here.</p>

  <div class="reasons sunken">
    <h2>If you followed a shared link</h2>
    <ul>
      <li>The link may have been mistyped or cut short when it was copied.</li>
      <li>Shared links stay valid, but the archive behind one can be moved or withdrawn by
      whoever published it.</li>
      <li>If you own the source, opening it again will restore the same link.</li>
    </ul>
  </div>

  <div class="row" style="justify-content:center; margin-top: 8px">
    <a class="btn btn-primary" href="/extract">${iconExtract(18)} Open an archive</a>
    <a class="btn" href="/bundle">${iconBundle(18)} Build an archive</a>
  </div>
</section>
`;

export function renderNotFoundPage(): string {
  return renderPage({
    title: 'Not found',
    description: 'That link does not lead anywhere.',
    active: 'none',
    css: CSS,
    body: BODY,
  });
}
