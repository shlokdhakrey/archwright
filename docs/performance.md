# Performance

## The core property: constant memory

Bodies are never buffered. A request builds a chain of `ReadableStream`
transforms and hands it to the runtime, which pulls from the origin only as fast
as the client drains. Memory is therefore **independent of file size** — a 2.5 GB
entry streams in the same footprint as a 2.5 MB one.

The benchmark (`node --expose-gc benchmarks/bench.mjs`) demonstrates this: logical
output grows to 500 MB while peak RSS stays flat.

| Logical output | Inflate throughput¹ | Peak RSS delta |
| -------------: | ------------------: | -------------: |
|          10 MB |           ~180 MB/s |         ~20 MB |
|         100 MB |           ~400 MB/s |         ~30 MB |
|         500 MB |           ~390 MB/s |         ~50 MB |

¹ Native `DecompressionStream('deflate-raw')`, Node 22. `workerd` uses the same
zlib-backed implementation. STORED entries are a passthrough (no decompression).

## Origin subrequests

| Scenario                   | Subrequests | Breakdown                          |
| -------------------------- | :---------: | ---------------------------------- |
| Cold download (CD in tail) |     ~3      | suffix probe · local header · data |
| Cold download (huge CD)    |     ~4      | + separate central-directory range |
| Warm (memo/cache hit)      |    ~2–3     | probe · local header · data        |
| HEAD                       |      1      | probe only                         |

Well within the Free plan's 50 external-subrequest limit.

## CPU: the dimension that matters

CPU time (not wall-clock) is what plan limits bound. Streaming is I/O-bound, so:

- **STORED entries cost ≈ 0 CPU.** They are a byte passthrough. An archive stored
  without compression streams at any size, even on the Free plan's CPU budget.
- **DEFLATE entries cost CPU proportional to the compressed bytes inflated**
  (~400 MB/s). Rough budget:

| Plan                           | CPU/invocation | Approx. DEFLATE bytes inflatable |
| ------------------------------ | -------------- | -------------------------------- |
| Free                           | limited        | ~100 MB                          |
| Paid (default)                 | 30 s           | ~10+ GB                          |
| Paid (`limits.cpu_ms: 300000`) | 5 min          | very large                       |

> Wall-clock is **not** limited while the client is connected, so slow clients
> and huge STORED files are fine on any plan. Only DEFLATE _inflation_ consumes
> the CPU budget.

### Range requests and DEFLATE

- **STORED + range:** O(1) — the range maps straight onto the origin. Perfect for
  media scrubbing.
- **DEFLATE + range:** O(offset) CPU — the stream must be inflated from the start
  and bytes before the range discarded. Seeking far into a large DEFLATE entry is
  expensive. If your workload seeks heavily, prefer STORED archives (see below).

## Latency

- **Time-to-first-byte** is dominated by origin round trips: the suffix probe,
  then (on a cache miss) the local-header fetch, then first data bytes. With a
  warm central-directory cache, TTFB is essentially one origin RTT plus inflate
  warm-up.
- The central-directory parse is pure in-memory byte scanning — microseconds for
  typical archives.

## Tuning

| Goal                        | Lever                                                                |
| --------------------------- | -------------------------------------------------------------------- |
| Faster repeat requests      | Keep `CACHE_TTL_SECONDS` > 0; bind `METADATA_KV` for cross-colo hits |
| Large DEFLATE archives      | Paid plan + `"limits": { "cpu_ms": 300000 }`                         |
| Heavy seeking / media       | Store archives **uncompressed** (STORED) for O(1) ranges             |
| Bound worst-case CPU/egress | Set `MAX_UNCOMPRESSED_BYTES` / `MAX_COMPRESSION_RATIO`               |
| Fewer origin round trips    | Use an origin whose tail contains the central directory (most do)    |
| Faster cold starts          | Already optimal: zero deps, ~23 KiB bundle, no `nodejs_compat`       |

## Why STORED archives are ideal here

If you control archive creation and want the best behaviour, store media
**without compression** (`zip -0`, or tools that STORE already-compressed media):

- Zero CPU to serve → works on Free at any size.
- O(1) range requests → instant seeking for video/audio players.
- `Content-Length` exact, `Accept-Ranges: bytes` — behaves exactly like a normal
  static file.

DEFLATE archives still work fully; they just trade CPU and seek cost for a
smaller archive.
