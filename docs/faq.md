# FAQ

**How is this different from unzipping to R2/storage and serving from there?**
No extraction, no storage, no duplication of bytes, and no sync problem. Files
are served live from the original archive using range requests, so there is
nothing to keep in sync and nothing to pay for storing twice.

**Does it download the whole archive?**
No. It reads the archive's index (the last ~64 KiB) and then streams only the one
entry you request. A 2.5 GB file inside a 50 GB archive is served without
touching the other 47.5 GB.

**How much memory does it use?**
Roughly constant, independent of file size, because bodies stream. See
[Performance](performance.md).

**Does it work on the Free plan?**
Yes for STORED entries (any size — they use ≈ 0 CPU) and small/medium DEFLATE
entries. Large DEFLATE entries need the Paid plan's higher CPU limit. Everything
else (ranges, caching, streaming) works on Free.

**Can clients seek (e.g. scrub a video)?**
STORED entries: yes, instantly — ranges map directly onto the origin. DEFLATE
entries: yes, but seeking is sequential (inflate-and-discard). For media, prefer
STORED archives.

**Which archives are supported?**
STORED and DEFLATE entries, ZIP64, data descriptors, UTF-8 and CP437 names,
Unicode Path extra fields, archive comments. Encrypted, multi-disk, and other
compression methods are not. See [Limitations](limitations.md).

**Where can the archive live?**
Any HTTP(S) origin that supports range requests: R2, S3, GCS, Azure Blob, a CDN,
your own server. Check with `node scripts/probe-archive.mjs <url>`.

**Is it an open proxy?**
No. Single-archive mode serves exactly one configured archive. Multi-archive mode
refuses to run without a host allowlist or a signing secret, and always blocks
private/reserved IPs.

**Why no `pako`/`fflate` for decompression?**
The runtime provides `DecompressionStream('deflate-raw')` natively — faster
(zlib in C++), zero bundle cost, and with proper backpressure. Bundling a JS
inflater would be slower and larger.

**Why zero runtime dependencies?**
Smaller bundle (~23 KiB), faster cold starts, minimal supply-chain surface, and
nothing to break on a Workers runtime update. Everything needed is a web
standard.

**Can I serve many different archives from one Worker?**
Yes — use multi-archive mode with an allowlist or signed references. See the
[multi-archive example](../examples/multi-archive/).

**How do I hide the fact that files come from a ZIP?**
That is the default. Clients see normal downloads with `Content-Length`,
`Accept-Ranges`, `ETag`, and `Content-Disposition`. There is no ZIP in the URL or
the response.

**Does it verify data integrity (CRC)?**
Not by default — that would require hashing the whole stream. The stored CRC is
used for ETags and Unicode-name validation. Opt-in verification is on the
[roadmap](roadmap.md).

**Is this an official Cloudflare project?**
No — it is an independent, MIT-licensed reference implementation.
