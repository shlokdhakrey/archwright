# 0001 — Native `DecompressionStream('deflate-raw')` for inflate

**Status:** Accepted

## Context

ZIP method 8 stores entries as raw DEFLATE (RFC 1951, no zlib header/trailer). We
must inflate it while streaming, in the Workers runtime, within tight CPU and
bundle-size limits. The common approach in JS is to bundle `pako` or `fflate`.

## Decision

Use the runtime's native `DecompressionStream('deflate-raw')`. It is a Web
Standard, available in Workers with no compatibility flag, and maps exactly to
ZIP's raw DEFLATE. We verified support and correctness against a real 2.5 GB
archive before committing.

## Consequences

- **Fast:** backed by zlib in C++, far quicker than a JS inflater.
- **Zero bundle cost:** no decompressor shipped (helps cold start; keeps the
  bundle ~23 KiB).
- **Native backpressure:** it is a `TransformStream`, so it composes into the
  streaming pipeline and only pulls as the client drains.
- **CPU is billed to the Worker:** large DEFLATE archives consume the plan CPU
  budget (documented in [performance](../performance.md)). STORED entries avoid
  this entirely (passthrough).
- We rely on a runtime primitive; if it regressed we would have no fallback. This
  risk is low (it is a stable web standard) and acceptable.

## Alternatives considered

- **Bundle `fflate`/`pako`:** larger bundle, slower, more CPU, added dependency.
  Rejected.
- **WASM zlib:** unnecessary given a native primitive exists; larger and more
  complex. Rejected.
