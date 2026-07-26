# 0006 — Test in Node via dependency injection

**Status:** Accepted

## Context

We want fast, reliable tests that exercise the real request pipeline. The Workers
runtime provides the web standards we use (Streams, `DecompressionStream`,
`fetch`, Web Crypto) — but so does modern Node. A `workerd`-pool test setup is
heavier and can be flakier.

## Decision

Make the primary suite run in Node's runtime. The application takes its
side-effecting collaborators — origin fetcher, cache, clock — through explicit
dependency injection (`Deps`, `createApp({ fetch, cache, clock })`). Tests build
real ZIP fixtures in memory, wire a mock origin and an in-memory cache, and call
`app.fetch(...)` directly.

## Consequences

- **Fast and deterministic:** 160+ tests run in ~2 s with no network and no
  `workerd`.
- **High fidelity:** the _real_ routing, middleware, ZIP parsing, and streaming
  code runs — not mocks of it. Node provides the same standard primitives at
  runtime; types come from the generated Workers runtime types.
- **Coverage is meaningful:** because the actual pipeline executes, coverage
  reflects real behaviour.
- A `workerd`-pool project remains valuable for asserting runtime-specific
  behaviour (Cache API, bindings) and is on the [roadmap](../roadmap.md).

## Alternatives considered

- **`@cloudflare/vitest-pool-workers` as the only suite:** highest fidelity but
  heavier/slower to run here, and unnecessary for the standards-based logic that
  is the bulk of the code. Deferred to a complementary suite.
