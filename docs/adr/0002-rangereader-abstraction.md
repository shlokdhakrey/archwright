# 0002 — Model byte access as a `RangeReader` interface

**Status:** Accepted

## Context

The ZIP layer needs random access to bytes of a remote resource. Coupling it
directly to `fetch` would make it untestable without a network and hard to reason
about.

## Decision

Define `RangeReader { size; validators; read(offset,length,signal); stream(offset,length,signal) }`
and write the entire ZIP layer against it (dependency inversion). Provide two
implementations: `HttpRangeReader` (ranged `fetch`, retries, suffix-probe, tail
reuse) and `BytesRangeReader` (in-memory buffer).

## Consequences

- **Testable:** unit and integration tests build a real ZIP in memory and read it
  through `BytesRangeReader` — exercising the exact production code paths with no
  network.
- **Swappable origin:** the ZIP layer is oblivious to HTTP; a future
  R2-binding-backed reader would slot in without touching parsing.
- **Optimisation lives in one place:** the HTTP reader's suffix-probe and tail
  caching (serving EOCD/CD reads from memory) are transparent to callers.
- Slightly more indirection than calling `fetch` inline — a worthwhile trade for
  testability and clarity.

## Alternatives considered

- **Call `fetch` directly in the ZIP layer:** simplest to write, but untestable
  offline and entangles concerns. Rejected.
