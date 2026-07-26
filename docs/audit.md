# Production Audit

A structured audit of the implementation for correctness, security, resource
safety, and Workers-runtime compatibility. It combined manual review, an
independent adversarial pass over the ZIP/streaming/HTTP/cache cores, empirical
validation against a real 2.5 GB archive, and a `workerd` boot test. This
document records what was checked, what was found, and how each item was
resolved.

## Validation performed

- **175 automated tests** (unit + integration) run the real request pipeline in
  Node via dependency injection; 89% statement / 83% branch coverage.
- **Real-archive end-to-end** (`tests/e2e/real-archive.test.ts`): lists an entry,
  HEADs it, and streams a 1 MiB range from a live 2.5 GB archive, verifying the
  inflated bytes are valid Matroska — and that only ~1 MiB is fetched, not 2.5 GB.
- **`workerd` boot**: `wrangler dev` serves `/__/health` and `/__/version` and
  emits structured logs — confirming no Workers-runtime incompatibility.
- **Bundle**: 24 KiB gzipped, zero runtime dependencies.
- **Benchmark**: constant memory while producing 500 MB of streamed output.

## Findings and resolutions

Severity reflects real-world exploitability given the threat model (origin is
operator-configured/allowlisted; the ZIP bytes are untrusted).

| #   | Severity | Finding                                                                                                                                                       | Resolution                                                                                                                                                      |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Medium   | EOCD located by "last signature in window" could mis-parse a valid archive whose comment contains `PK\x05\x06`.                                               | `findEndOfCentralDirectory` now prefers a candidate whose comment-length is consistent with EOF (matching Go/Python `zipfile` behavior). Regression test added. |
| 2   | Medium   | SSRF private-IP block missed **all IPv6 literals** — `URL.hostname` keeps brackets (`[::1]`) and hex-normalises IPv4-mapped addresses (`[::ffff:a9fe:a9fe]`). | Strip brackets; handle dotted **and** hex IPv4-mapped forms; broaden ULA/link-local matching. Tests cover the exact `URL.hostname` forms.                       |
| 3   | Low-Med  | Unbounded buffering: structural reads used `arrayBuffer()` with no cap, so a misbehaving origin could force OOM.                                              | All buffered reads go through `readCapped()` (bounded `collectStream`); over-limit → `UpstreamError`.                                                           |
| 4   | Low-Med  | Cache key fell back to byte-size when the origin had no validator → a same-size content swap could serve a stale index.                                       | Caching is disabled entirely when the origin exposes no ETag/Last-Modified. Test added.                                                                         |
| 5   | Low-Med  | STORED entry with `compressedSize ≠ uncompressedSize` desynced `Content-Length` from the streamed body.                                                       | `assertEntryServable` rejects such entries as `malformed_archive`. Test added.                                                                                  |
| 6   | Low-Med  | `readCapped` threw on cap-exceed without cancelling the body → undrained origin connection.                                                                   | The catch path now `drainResponse`s before throwing.                                                                                                            |
| 7   | Low      | Parse `RangeError`s from corrupt input surfaced as `500 internal_error` instead of `502 malformed_archive`.                                                   | The origin parse path maps `RangeError` → `MalformedArchiveError`.                                                                                              |
| 8   | Low      | Dead code: unused `bytesToHex` export.                                                                                                                        | Removed.                                                                                                                                                        |

## Reviewed and confirmed correct

- ZIP64 EOCD/locator offsets; ZIP64 extra-field sentinel promotion (APPNOTE
  4.5.3); local-file-header data-offset (uses the LFH's own lengths, not the
  CD's); data-descriptor (bit 3) size resolution from the central directory.
- Central-directory bounds/overrun guards; first-wins duplicate handling.
- `parseRange` / `Content-Range` / `Content-Length` — RFC 9110, no off-by-one.
- STORED and DEFLATE range skip/take slicing; the DEFLATE full-body length cap
  bounds both egress and CPU (terminate cancels the decompressor).
- Abort/timeout: the TTFB timer is disarmed once headers arrive (long bodies are
  never killed), while a client disconnect cancels the origin stream.
- End-to-end backpressure; streams always terminate for well-formed bodies.
- Header-injection defenses (`Content-Disposition`, ETag); HMAC verified before
  payload parse; `directoryMemo` is race-free (synchronous map ops).

## Residual, accepted

- **`finalize` header mutation** relies on all handlers returning freshly
  constructed (mutable) responses. This invariant currently holds; if a future
  handler returns a raw `fetch`/`cache.match` response, the app's last-resort
  catch still yields a clean 500. Noted for maintainers.
- **`fetchWithResilience` success path** leaves the client-abort listener
  attached for buffered structural reads (bounded per request, GC'd at request
  end). Kept intentionally for the streaming path; not a leak in practice.
- **DOS timestamp** decoding permits an out-of-range day to roll over in
  `Last-Modified` — cosmetic only.
- **Pathological EOCD** (a stray signature whose zero comment-length happens to
  reach EOF) remains ambiguous, as it is for reference parsers.
