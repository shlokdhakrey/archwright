# Benchmarks

## `bench.mjs` — streaming decompression & memory

Micro-benchmarks the two properties Archwright depends on: native raw-DEFLATE
throughput, and constant memory while producing arbitrarily large output.

```bash
node --expose-gc benchmarks/bench.mjs            # default sizes
node --expose-gc benchmarks/bench.mjs 10 100 1000  # custom logical sizes (MB)
```

Because the compressible input decompresses to large output that is **streamed
and discarded**, peak RSS stays flat as logical size grows — the same mechanism
that lets the Worker serve multi-gigabyte entries within the 128 MB isolate.

### Representative results

Native `DecompressionStream('deflate-raw')`, Node 22 (results vary by machine):

| Logical output | Inflate throughput | Peak RSS delta |
| -------------: | -----------------: | -------------: |
|          10 MB |          ~180 MB/s |         ~20 MB |
|         100 MB |          ~400 MB/s |         ~30 MB |
|         500 MB |          ~390 MB/s |         ~50 MB |

The Workers runtime (`workerd`) uses the same zlib-backed implementation.

## Interpreting these numbers

- **STORED entries** cost effectively **zero CPU** — they are a passthrough — so
  throughput is bounded only by the origin and the client.
- **DEFLATE entries** cost CPU proportional to the compressed bytes inflated.
  This is the dimension to watch against the plan CPU limit (Free 10 ms, Paid up
  to 5 min). See [docs/performance.md](../docs/performance.md).

## Load testing a deployment

For end-to-end latency/throughput against a real deployment, drive
`scripts/smoke.mjs` in a loop, or use a tool like [`oha`](https://github.com/hatoo/oha)
or `k6` against the download endpoint with a `Range` header.
