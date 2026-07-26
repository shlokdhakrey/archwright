# 0005 — Zero runtime dependencies

**Status:** Accepted

## Context

Workers bundles have size limits (Free 3 MB gzip), cold-start cost scales with
bundle size, and every dependency is supply-chain surface and a potential source
of runtime incompatibility.

## Decision

Ship **no runtime dependencies**. Use only Web/Workers standards: `fetch`,
Streams, `DecompressionStream`, Web Crypto, `TextEncoder`/`TextDecoder`, the
Cache API. Dev-only tooling (TypeScript, Wrangler, Vitest, ESLint, Prettier) is
fine.

## Consequences

- **Tiny bundle** (~23 KiB gzip) → fast cold starts, well under all plan limits.
- **Minimal supply-chain risk** at runtime; nothing to audit or patch in the
  hot path.
- **Resilient to runtime updates** — no dependency assuming a Node shim or a
  specific polyfill.
- We occasionally write a little more code (e.g. CP437 table, CRC-32) instead of
  importing it — a small, well-tested cost.

## Alternatives considered

- **Use `fflate`/`yauzl`-style libraries:** faster to write initially, but larger
  bundle, added risk, and typically not designed for streaming from a remote
  range source. Rejected.
- **`nodejs_compat` + Node libraries:** heavier runtime, slower cold start,
  unnecessary. Rejected.
