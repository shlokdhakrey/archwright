/**
 * The design system.
 *
 * Direction: **engineered stone**. The product is named for a wright who works
 * arches, so the surfaces are treated as a single carved material — panels and
 * controls are extruded from the page rather than stacked on it. That is a
 * deliberate reading of neumorphism: one monochrome ground, light from the
 * top-left, depth carried entirely by paired shadows.
 *
 * Two rules keep it from becoming the usual soft-grey mush:
 *
 *  - **Only surfaces are soft. Text never is.** The classic failure of this
 *    style is low-contrast type; here foreground colours are held at full
 *    strength and only the material behind them is subtle.
 *  - **One accent, used sparingly.** A single viridian carries every action.
 *    No second hue competes, and nothing is tinted for decoration.
 *
 * The ground is a cool slate rather than the warm cream that has become the
 * default for generated interfaces, and the corner radius is a deliberate small
 * scale instead of everything being maximally rounded.
 */

/** Fonts. A characterful grotesque for display, an engineering sans for text. */
export const FONT_LINK = [
  '<link rel="preconnect" href="https://fonts.googleapis.com" />',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />',
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?',
  'family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&',
  'family=IBM+Plex+Sans:wght@400;500;600&',
  'family=IBM+Plex+Mono:wght@400;500&display=swap" />',
].join('');

/** Tokens plus the base layer every page shares. */
export const BASE_CSS = `
:root {
  /* One carved material, lit from the top-left. */
  --stone:      #e6e9ee;
  --stone-hi:   #ffffff;
  --stone-lo:   #bdc3cd;
  --sunk:       #dde1e8;

  --ink:        #12171d;
  --ink-soft:   #4a5563;
  --ink-faint:  #5b6674;
  --edge:       #cdd3dc;

  --accent:     #12705e;
  --accent-ink: #ffffff;
  --accent-sub: #0d5647;

  --warn:       #8a4b12;
  --danger:     #9b2c2c;
  --good:       #12705e;

  --r-sm: 8px;
  --r-md: 12px;
  --r-lg: 18px;

  --lift: 6px 6px 14px var(--stone-lo), -6px -6px 14px var(--stone-hi);
  --lift-sm: 3px 3px 7px var(--stone-lo), -3px -3px 7px var(--stone-hi);
  --carve: inset 4px 4px 9px var(--stone-lo), inset -4px -4px 9px var(--stone-hi);
  --carve-sm: inset 2px 2px 5px var(--stone-lo), inset -2px -2px 5px var(--stone-hi);
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --stone:      #1b2026;
    --stone-hi:   #262c34;
    --stone-lo:   #10141a;
    --sunk:       #171c22;

    --ink:        #e8edf3;
    --ink-soft:   #a7b2c0;
    --ink-faint:  #828d99;
    --edge:       #2b323a;

    --accent:     #46c2a5;
    --accent-ink: #08140f;
    --accent-sub: #6ad4bb;

    --warn:       #d9a163;
    --danger:     #ef8a7c;
    --good:       #46c2a5;
  }
}

:root[data-theme="dark"] {
  --stone:      #1b2026;
  --stone-hi:   #262c34;
  --stone-lo:   #10141a;
  --sunk:       #171c22;

  --ink:        #e8edf3;
  --ink-soft:   #a7b2c0;
  --ink-faint:  #828d99;
  --edge:       #2b323a;

  --accent:     #46c2a5;
  --accent-ink: #08140f;
  --accent-sub: #6ad4bb;

  --warn:       #d9a163;
  --danger:     #ef8a7c;
  --good:       #46c2a5;
}

* { box-sizing: border-box; }

html { -webkit-text-size-adjust: 100%; }

body {
  margin: 0;
  background: var(--stone);
  color: var(--ink);
  font-family: "IBM Plex Sans", ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  font-size: 16px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}

h1, h2, h3, h4 {
  font-family: "Bricolage Grotesque", "IBM Plex Sans", system-ui, sans-serif;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.08;
  margin: 0;
  text-wrap: balance;
}

p { margin: 0; }

a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; text-underline-offset: 3px; }

:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
  border-radius: var(--r-sm);
}

code, .mono {
  font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.9em;
}

/* --- the carved material ------------------------------------------------- */

.raised {
  background: var(--stone);
  border-radius: var(--r-lg);
  box-shadow: var(--lift);
}

.sunken {
  background: var(--sunk);
  border-radius: var(--r-md);
  box-shadow: var(--carve);
}

/* Controls are extruded, and physically depress when used. */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  font: inherit;
  font-weight: 500;
  color: var(--ink);
  background: var(--stone);
  border: 0;
  border-radius: var(--r-md);
  padding: 12px 20px;
  cursor: pointer;
  box-shadow: var(--lift-sm);
  transition: box-shadow 140ms ease, transform 140ms ease, color 140ms ease;
  text-decoration: none;
  white-space: nowrap;
}
.btn:hover { color: var(--accent); text-decoration: none; }
.btn:active { box-shadow: var(--carve-sm); transform: translateY(1px); }
.btn[disabled], .btn.is-disabled {
  opacity: 0.45;
  cursor: not-allowed;
  box-shadow: var(--carve-sm);
}

.btn-primary {
  background: var(--accent);
  color: var(--accent-ink);
  box-shadow: var(--lift-sm);
}
.btn-primary:hover { color: var(--accent-ink); filter: brightness(1.07); }

.btn-sm { padding: 8px 14px; font-size: 14px; border-radius: var(--r-sm); }

/* Inputs are carved into the surface, not stacked on it. */
.field {
  width: 100%;
  font: inherit;
  color: var(--ink);
  background: var(--sunk);
  border: 0;
  border-radius: var(--r-md);
  padding: 13px 16px;
  box-shadow: var(--carve-sm);
  min-width: 0;
}
.field::placeholder { color: var(--ink-faint); }
.field:focus { outline: 2px solid var(--accent); outline-offset: 2px; }

textarea.field {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 14px;
  line-height: 1.7;
  resize: vertical;
}

/* --- layout helpers ------------------------------------------------------ */

.shell { max-width: 1120px; margin: 0 auto; padding: 0 24px; }
.narrow { max-width: 760px; }
.stack { display: grid; gap: 16px; }
.row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.spread { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.grow { flex: 1; min-width: 0; }
.hidden { display: none !important; }

.eyebrow {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--accent);
}

.lede { font-size: 19px; color: var(--ink-soft); max-width: 60ch; }
.muted { color: var(--ink-soft); }
.faint { color: var(--ink-faint); font-size: 14px; }

.tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  padding: 5px 11px;
  border-radius: 999px;
  background: var(--sunk);
  box-shadow: var(--carve-sm);
  color: var(--ink-soft);
  white-space: nowrap;
}
.tag-good { color: var(--good); }
.tag-warn { color: var(--warn); }

.note {
  border-radius: var(--r-md);
  background: var(--sunk);
  box-shadow: var(--carve-sm);
  padding: 16px 18px;
  font-size: 15px;
  color: var(--ink-soft);
}

@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.001ms !important; transition-duration: 0.001ms !important; }
}
`;
