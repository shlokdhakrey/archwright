import { SERVICE_NAME } from '../constants/app.js';
import { FAVICON_LINK } from './favicon.js';
import { iconBundle, iconExtract, iconGuide, iconMoon, iconSun, logoMark } from './icons.js';
import { BASE_CSS, FONT_LINK } from './theme.js';

/** Which primary destination is currently open. */
export type NavKey = 'home' | 'extract' | 'bundle' | 'guide' | 'none';

export interface PageOptions {
  /** Shown in the tab; the product name is appended. */
  readonly title: string;
  readonly description?: string;
  readonly active?: NavKey;
  /** Page-specific CSS appended after the base layer. */
  readonly css?: string;
  readonly body: string;
  /** Page-specific script, injected at the end of the body. */
  readonly script?: string;
  /** Set false for pages that stand alone, such as sign-in. */
  readonly chrome?: boolean;
}

/**
 * Applied before first paint so a chosen theme never flashes the other one.
 * Written without escape sequences: this file is a template literal, and a
 * stray backslash would be swallowed by it.
 */
const THEME_BOOT =
  "try{var t=localStorage.getItem('aw-theme');" +
  "if(t){document.documentElement.setAttribute('data-theme',t);}}catch(e){}";

const THEME_TOGGLE =
  '(function(){' +
  "var b=document.getElementById('theme-toggle');if(!b)return;" +
  'var root=document.documentElement;' +
  'function current(){' +
  "var set=root.getAttribute('data-theme');if(set)return set;" +
  "return window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}" +
  "function paint(){b.setAttribute('aria-label'," +
  "current()==='dark'?'Switch to light theme':'Switch to dark theme');}" +
  "b.addEventListener('click',function(){" +
  "var next=current()==='dark'?'light':'dark';" +
  "root.setAttribute('data-theme',next);" +
  "try{localStorage.setItem('aw-theme',next);}catch(e){}" +
  'paint();});paint();})();';

function navLink(href: string, label: string, glyph: string, active: boolean): string {
  return [
    `<a class="nav-link${active ? ' is-active' : ''}" href="${href}"`,
    active ? ' aria-current="page"' : '',
    `>${glyph}<span>${label}</span></a>`,
  ].join('');
}

const CHROME_CSS = `
.topbar { padding: 20px 0 8px; }
.brand {
  display: inline-flex; align-items: center; gap: 11px;
  color: var(--ink); font-family: "Bricolage Grotesque", system-ui, sans-serif;
  font-weight: 800; font-size: 19px; letter-spacing: -0.02em; text-decoration: none;
}
.brand:hover { text-decoration: none; color: var(--accent); }
.brand .mark { color: var(--accent); display: grid; place-items: center; }

.nav { display: flex; align-items: center; gap: 6px; }
.nav-link {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 9px 14px; border-radius: var(--r-md);
  color: var(--ink-soft); font-size: 15px; font-weight: 500; text-decoration: none;
}
.nav-link:hover { color: var(--ink); text-decoration: none; box-shadow: var(--lift-sm); }
.nav-link.is-active { color: var(--accent); box-shadow: var(--carve-sm); background: var(--sunk); }
.nav-link svg { opacity: 0.9; }

.icon-btn {
  display: grid; place-items: center;
  width: 40px; height: 40px; padding: 0;
  border: 0; border-radius: var(--r-md);
  background: var(--stone); color: var(--ink-soft);
  box-shadow: var(--lift-sm); cursor: pointer;
}
.icon-btn:hover { color: var(--accent); }
.icon-btn:active { box-shadow: var(--carve-sm); }

.sitefoot {
  margin-top: 96px; padding: 28px 0 40px;
  border-top: 1px solid var(--edge);
  color: var(--ink-faint); font-size: 14px;
}
.sitefoot a { color: var(--ink-soft); }

@media (max-width: 720px) {
  .nav-link span { display: none; }
  .nav-link { padding: 9px 11px; }
}
`;

function chrome(active: NavKey): { head: string; foot: string } {
  const head = [
    '<header class="topbar"><div class="shell spread">',
    `<a class="brand" href="/"><span class="mark">${logoMark(26)}</span>${SERVICE_NAME}</a>`,
    '<nav class="nav" aria-label="Primary">',
    navLink('/extract', 'Extract', iconExtract(18), active === 'extract'),
    navLink('/bundle', 'Bundle', iconBundle(18), active === 'bundle'),
    navLink('/guide', 'Guide', iconGuide(18), active === 'guide'),
    `<button class="icon-btn" id="theme-toggle" type="button" aria-label="Switch theme">`,
    `<span class="only-light">${iconMoon(18)}</span>`,
    `<span class="only-dark">${iconSun(18)}</span>`,
    '</button>',
    '</nav></div></header>',
  ].join('');

  const foot = [
    '<footer class="sitefoot"><div class="shell spread">',
    `<span>${SERVICE_NAME} — open any archive, or assemble one.</span>`,
    '<span><a href="/guide">How it works</a></span>',
    '</div></footer>',
  ].join('');

  return { head, foot };
}

/** Render a complete page in the product's shell. */
export function renderPage(options: PageOptions): string {
  const withChrome = options.chrome !== false;
  const parts = withChrome ? chrome(options.active ?? 'none') : { head: '', foot: '' };
  const description = options.description ?? 'Open any archive, or assemble one.';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light dark" />
<meta name="description" content="${description}" />
<title>${options.title} · ${SERVICE_NAME}</title>
${FAVICON_LINK}
${FONT_LINK}
<script>${THEME_BOOT}</script>
<style>${BASE_CSS}
/* Theme-toggle glyph swap, driven by the same three-state rule as the palette. */
.only-dark { display: none; }
:root[data-theme="dark"] .only-dark { display: block; }
:root[data-theme="dark"] .only-light { display: none; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .only-dark { display: block; }
  :root:not([data-theme="light"]) .only-light { display: none; }
}
${withChrome ? CHROME_CSS : ''}
${options.css ?? ''}</style>
</head>
<body>
${parts.head}
<main>${options.body}</main>
${parts.foot}
<script>${THEME_TOGGLE}</script>
${options.script ? `<script>${options.script}</script>` : ''}
</body>
</html>`;
}
