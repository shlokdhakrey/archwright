# Roadmap

Directional, not a commitment. Contributions welcome — see
[CONTRIBUTING.md](../CONTRIBUTING.md).

## Near term

- **Opt-in CRC-32 verification** — a config flag to checksum the streamed bytes
  and fail closed on mismatch (trading CPU for integrity).
- **`workerd`-pool test project** — an additional `vitest` project running the
  suite inside the production runtime, alongside the fast Node suite.
- **Prometheus/Analytics Engine metrics recipe** — a documented dashboard for
  cache hit ratio, origin latency, bytes streamed, and error rates.
- **Directory index HTML** — an optional human-friendly listing page.

## Medium term

- **Additional compression methods** where a native/WASM primitive is viable
  (e.g. Zstandard as runtime support matures), behind a capability flag.
- **Signed URL adapters** — first-class helpers for generating R2/S3/GCS signed
  archive URLs so the Worker never holds long-lived credentials.
- **Partial central-directory streaming** for archives with millions of entries,
  to bound memory further.
- **Conditional revalidation of the cached directory** via a cheap tail HEAD when
  the TTL elapses, instead of re-parsing.

## Under consideration

- **Range coalescing / multi-range** responses (`multipart/byteranges`) if a
  concrete use case emerges.
- **Tar and other container formats** behind the same `RangeReader` abstraction.
- **On-the-fly re-zipping** of a subset of entries (streaming ZIP _creation_),
  the inverse of today's read path.

## Explicitly out of scope

- Decryption of encrypted archives.
- Extracting/persisting archives to storage (defeats the purpose).
- Acting as a general-purpose HTTP proxy.
