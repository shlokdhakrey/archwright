# Limitations

Honest boundaries, and why each exists.

## Origin must support HTTP range requests

The entire approach depends on `Range` requests to read the ZIP index and stream
one entry. Object stores (R2, S3, GCS, Azure Blob) and most CDNs support ranges.
If an origin ignores ranges and returns the whole body, ZipStream only proceeds
when that body is small enough to buffer (`MAX_CENTRAL_DIRECTORY_BYTES`);
otherwise it returns an upstream error. Verify with
`node scripts/probe-archive.mjs <url>`.

## DEFLATE range requests are sequential

STORED entries support O(1) random-access ranges. **DEFLATE entries must be
inflated from the start**, so serving a range means inflating and discarding up
to the range start (O(offset) CPU). This is inherent to the DEFLATE format, not a
shortcut. For heavy seeking (media scrubbing), prefer STORED archives. See
[Performance](performance.md).

## Large DEFLATE downloads work on Free — by not decompressing

A **full** DEFLATE download is served by passing the entry's already-compressed
bytes straight through under `Content-Encoding: deflate` and letting the *client*
inflate. The origin body is returned directly (`new Response(body)` with no stream
transform), so the bytes are spliced edge-to-edge and never enter the isolate: the
Worker spends **≈ 0 CPU regardless of size**. A 2.4 GB entry streams end-to-end on
the Free plan at ~12 ms CPU — the same zero-copy technique Drive-index Workers use
for huge files. This is the default; disable with `DEFLATE_PASSTHROUGH=false`.

Why not do this by re-framing as gzip? Injecting gzip's 10-byte header and 8-byte
trailer requires a `TransformStream`, and *any* transform drags every byte through
the JS isolate — which on the Free plan exhausts the ~2 s CPU budget at ~125 MB
(`wrangler tail` shows `outcome: exceededCpu`, `cpuTime: ~2020`). Raw DEFLATE under
`Content-Encoding: deflate` needs no framing at all, so it stays zero-copy. Every
major browser, `curl`, and common HTTP libraries inflate it (they fall back to raw
RFC 1951 DEFLATE — the historical "deflate" content-coding behaviour).

**Strict clients are the exception.** The HTTP `deflate` coding is *nominally*
zlib-wrapped (RFC 1950), and a few clients — notably some download managers
(IDM, 1DM) — use a strict zlib that rejects the raw stream with
`unknown compression method`. There is no zero-CPU stream that is *also* universally
decodable for a compressed source entry: making it universal means re-framing (gzip),
which reintroduces the per-byte CPU cost above. The download-manager workarounds
(browser download, `Accept-Encoding: identity`, or `DEFLATE_PASSTHROUGH=false`) are
in [Troubleshooting](troubleshooting.md). STORED entries have no such caveat — they
are a plain identity passthrough every client handles.

Two related paths remain CPU-bound on Free, because they genuinely must touch the
bytes:

- **DEFLATE ranges** must be inflated server-side (you cannot seek an encoded
  body), so a single request inflates roughly ~100 MB before hitting the limit.
  Prefer STORED archives for heavy seeking. See the note above.
- **Combined multi-file ZIP** (`/__/zip`) frames entries through a streaming ZIP
  writer, which passes bytes through the isolate; that path handles a few hundred
  MB on Free. For huge combined downloads use the Paid plan
  (`limits.cpu_ms`, up to 5 min CPU).

**STORED entries cost ≈ 0 CPU** at any size on Free for both full downloads and
ranges (a plain origin passthrough). The Paid plan removes the range/combined
ceilings for DEFLATE.

## Encrypted and multi-disk archives are unsupported

Traditional/strong ZIP encryption and spanned (multi-disk) archives are refused
explicitly (`501`/`502`). Decryption is out of scope; multi-disk is effectively
obsolete.

## Compression methods other than STORED/DEFLATE

Methods like BZIP2 (12), LZMA (14), Zstandard (93), and PPMd (98) are listed by
`/__/list` but cannot be served (`501`). Only STORED (0) and DEFLATE (8) — which
cover the overwhelming majority of real archives — are supported, because they
map to native runtime primitives without bundling a decompressor.

## Single range per request

Multi-range requests (`bytes=0-10,20-30`) are intentionally ignored (the full
body is served) rather than answered with `multipart/byteranges`, which adds
complexity with no benefit for the media/download use cases here.

## SSRF allowlisting is by hostname

The allowlist cannot see post-DNS resolution, so it does not by itself defend
against DNS rebinding. Keep the allowlist to trusted object-storage hosts, and
prefer signed references for untrusted callers. Cloudflare's network blocks many
internal targets, and private IP literals are rejected regardless.

## Very large central directories

Archives with millions of entries produce a large central directory. It is
buffered and parsed in memory, bounded by `MAX_CENTRAL_DIRECTORY_BYTES` (64 MiB
default) and `MAX_ENTRY_COUNT`. Increase them if needed, mindful of the 128 MB
isolate.

## 64-bit sizes beyond `Number.MAX_SAFE_INTEGER`

ZIP64 sizes/offsets above 2⁵³−1 (~9 PB) are rejected rather than silently losing
precision. No real archive approaches this.

## CRC verification is not performed by default

The entry's stored CRC-32 is used for the ETag and Unicode-name validation, but
the streamed bytes are not re-checksummed (that would require hashing the whole
stream, adding CPU). The origin and ZIP structure are trusted for integrity. A
future opt-in verification mode is on the [roadmap](roadmap.md).
