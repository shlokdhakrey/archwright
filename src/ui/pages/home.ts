import { iconArrow, iconBundle, iconExtract, iconPlay } from '../icons.js';
import { renderPage } from '../layout.js';

/**
 * The homepage.
 *
 * Its job is to make one distinction land immediately: this tool runs in two
 * directions. Everything else is subordinate to that, so the hero carries a
 * single drawing of the idea and the two directions are given equal weight
 * below it rather than being buried in a feature list.
 */

const HERO_ART = [
  '<svg class="hero-art" viewBox="0 0 420 260" role="img"',
  ' aria-label="Files passing through an arch in both directions">',
  // The arch: the product itself.
  '<path d="M110 214V138a100 100 0 0 1 200 0v76" fill="none" stroke="currentColor"',
  ' stroke-width="10" stroke-linecap="round" class="art-arch" />',
  '<path d="M86 214h248" fill="none" stroke="currentColor" stroke-width="10"',
  ' stroke-linecap="round" class="art-arch" />',
  // Material moving through it.
  // A gradient stroke would need userSpaceOnUse here: a horizontal line has a
  // zero-height bounding box, which makes an objectBoundingBox gradient degenerate.
  '<g class="art-flow" stroke="currentColor" stroke-width="6" stroke-linecap="round">',
  '<path d="M20 120h80" /><path d="M320 120h80" />',
  '<path d="M20 156h60" /><path d="M340 156h60" />',
  '<path d="M20 84h50" /><path d="M350 84h50" />',
  '</g>',
  // Files, drawn as the same spans the icons use.
  '<g class="art-files" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round">',
  '<rect x="150" y="96" width="52" height="16" rx="8" />',
  '<rect x="218" y="96" width="52" height="16" rx="8" />',
  '<rect x="150" y="130" width="52" height="16" rx="8" />',
  '<rect x="218" y="130" width="52" height="16" rx="8" />',
  '<rect x="184" y="164" width="52" height="16" rx="8" />',
  '</g>',
  '</svg>',
].join('');

const CSS = `
.hero { padding: 56px 0 24px; }
.hero-grid { display: grid; gap: 44px; align-items: center; }
@media (min-width: 900px) { .hero-grid { grid-template-columns: 1.05fr 0.95fr; } }

.hero h1 { font-size: clamp(40px, 6.4vw, 68px); margin: 16px 0 20px; }
.hero .lede { font-size: 20px; }
.hero-cta { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 30px; }

.hero-art {
  width: 100%; height: auto; color: var(--accent);
  filter: drop-shadow(4px 6px 10px var(--stone-lo));
}
.art-arch { opacity: 0.95; }
.art-files { opacity: 0.34; }
.art-flow { opacity: 0.5; stroke-dasharray: 14 12; animation: drift 3.4s linear infinite; }
@keyframes drift { to { stroke-dashoffset: -52; } }

.paths { display: grid; gap: 20px; margin-top: 76px; }
@media (min-width: 820px) { .paths { grid-template-columns: 1fr 1fr; } }

.path { padding: 30px 30px 26px; display: grid; gap: 14px; align-content: start; }
.path-head { display: flex; align-items: center; gap: 13px; }
.path-mark {
  width: 46px; height: 46px; border-radius: var(--r-md);
  display: grid; place-items: center;
  background: var(--sunk); box-shadow: var(--carve-sm); color: var(--accent);
}
.path h2 { font-size: 25px; }
.path p { color: var(--ink-soft); }
.path ul { margin: 4px 0 0; padding-left: 18px; color: var(--ink-soft); font-size: 15px; }
.path li { margin-bottom: 6px; }
.path li::marker { color: var(--accent); }
.path .btn { justify-self: start; margin-top: 8px; }

.strip { margin-top: 76px; display: grid; gap: 18px; }
@media (min-width: 780px) { .strip { grid-template-columns: repeat(3, 1fr); } }
.strip-item { padding: 24px; display: grid; gap: 9px; align-content: start; }
.strip-item h3 { font-size: 17px; }
.strip-item p { font-size: 15px; color: var(--ink-soft); }

.closer {
  margin-top: 84px; padding: 44px 40px; text-align: center;
  display: grid; gap: 18px; justify-items: center;
}
.closer h2 { font-size: clamp(26px, 3.6vw, 36px); }
`;

const BODY = `
<section class="hero"><div class="shell hero-grid">
  <div>
    <p class="eyebrow">Archives, both directions</p>
    <h1>Reach inside an archive. Or build one from anywhere.</h1>
    <p class="lede">Pull a single file out of a huge ZIP without downloading the rest — or gather
    files scattered across the web into one archive. Nothing is ever stored, and there is no size
    limit on either direction.</p>
    <div class="hero-cta">
      <a class="btn btn-primary" href="/extract">${iconExtract(18)} Open an archive</a>
      <a class="btn" href="/bundle">${iconBundle(18)} Build an archive</a>
    </div>
  </div>
  <div>${HERO_ART}</div>
</div></section>

<section class="shell">
  <div class="paths">
    <article class="path raised">
      <div class="path-head">
        <span class="path-mark">${iconExtract(24)}</span>
        <h2>Open an archive</h2>
      </div>
      <p>Paste a link to any ZIP and read its contents straight away. Take one file, take several,
      or repackage a selection.</p>
      <ul>
        <li>Browse everything inside before committing to a download</li>
        <li>Download a single file, however large the archive</li>
        <li>Play video and audio without extracting anything first</li>
        <li>Repackage a selection as ZIP or TAR</li>
      </ul>
      <a class="btn" href="/extract">Open an archive ${iconArrow(17)}</a>
    </article>

    <article class="path raised">
      <div class="path-head">
        <span class="path-mark">${iconBundle(24)}</span>
        <h2>Build an archive</h2>
      </div>
      <p>Hand over a list of links and get one archive back. The files stay where they are until
      somebody downloads them.</p>
      <ul>
        <li>One permanent link for the whole set</li>
        <li>Choose ZIP or TAR at download time</li>
        <li>Interrupted downloads pick up where they stopped</li>
        <li>Works with download managers</li>
      </ul>
      <a class="btn" href="/bundle">Build an archive ${iconArrow(17)}</a>
    </article>
  </div>

  <div class="strip">
    <div class="strip-item raised">
      <h3>Nothing is stored</h3>
      <p>Files are read from wherever they already live and streamed straight to you. No copy is
      kept, so nothing is left behind to leak or expire.</p>
    </div>
    <div class="strip-item raised">
      <h3>Links that keep working</h3>
      <p>Share a short link to an archive or a single file. Refreshing the source behind it does not
      change the link you handed out.</p>
    </div>
    <div class="strip-item raised">
      <h3>Watch before you download</h3>
      <p>${iconPlay(15)} Video and audio inside an archive play in the browser, with subtitles picked
      up automatically when they sit alongside.</p>
    </div>
  </div>

  <section class="closer raised">
    <h2>Start with a link</h2>
    <p class="lede" style="text-align:center">Anything reachable over the web works — no account, no
    upload, no waiting for a copy to be made.</p>
    <div class="row" style="justify-content:center">
      <a class="btn btn-primary" href="/extract">${iconExtract(18)} Open an archive</a>
      <a class="btn" href="/bundle">${iconBundle(18)} Build an archive</a>
    </div>
  </section>
</section>
`;

export function renderHomePage(): string {
  return renderPage({
    title: 'Open any archive, or assemble one',
    description:
      'Pull a single file out of a huge ZIP without downloading the rest, or gather files from across the web into one archive.',
    active: 'home',
    css: CSS,
    body: BODY,
  });
}
