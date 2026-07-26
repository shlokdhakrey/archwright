# Architecture

ZipStream is a layered Cloudflare Worker. Each layer has a single
responsibility, depends only on abstractions below it, and is independently
testable. This document covers the component structure, the request lifecycle,
the streaming pipeline, and the cache flow.

## Contents

- [Component overview](#component-overview)
- [Layered design & dependency inversion](#layered-design--dependency-inversion)
- [Request lifecycle](#request-lifecycle)
- [ZIP reading strategy](#zip-reading-strategy)
- [Streaming pipeline](#streaming-pipeline)
- [Cache flow](#cache-flow)
- [Abort & backpressure](#abort--backpressure)

---

## Component overview

```mermaid
flowchart TB
    subgraph Edge["Cloudflare Worker (isolate, 128 MB)"]
        direction TB
        IDX[index.ts / app.ts<br/>entry + assembly]
        MW[Middleware<br/>finalize · logging · error boundary]
        RT[Router<br/>route resolution + dispatch]
        H[Handlers<br/>download · list · meta · health · version]

        subgraph Domain["Domain services"]
            direction LR
            ZIP[zip/<br/>EOCD · central dir · local header · ZIP64 · CRC]
            STR[streaming/<br/>inflate · slice · meter · pipeline]
            HTTP[http/<br/>RangeReader · range · conditional]
            CACHE[cache/<br/>memo · Cache API · KV]
            SEC[security/<br/>SSRF · guards · signing]
        end

        CFG[config/ · observability/ · errors/ · utils/]

        IDX --> MW --> RT --> H
        H --> ZIP & STR & HTTP & CACHE & SEC
        ZIP --> HTTP
        STR --> ZIP
    end

    H -->|HTTP Range| ORIGIN[(Remote ZIP origin<br/>R2 · S3 · GCS · any HTTP)]
    CACHE -.optional.-> KV[(KV)]
    H -.per-colo.-> CAPI[(Cache API)]
    CLIENT((Client)) --> IDX
    H ==>|streamed body| CLIENT
```

The **data plane** (download) and **control plane** (list/meta/health/version)
share the same pipeline; only the terminal handler differs.

---

## Layered design & dependency inversion

The core abstraction is `RangeReader` — "random access over a byte source of
known size." The entire ZIP layer is written against it and knows nothing about
HTTP:

```mermaid
classDiagram
    class RangeReader {
        <<interface>>
        +size: number
        +validators: Validators
        +read(offset, length, signal) Uint8Array
        +stream(offset, length, signal) RangeStream
    }
    class HttpRangeReader {
        suffix-probe + tail reuse + retry/timeout
    }
    class BytesRangeReader {
        in-memory buffer (tests/fixtures)
    }
    class ZipArchive {
        getEntry() · resolveData() · stream()
    }
    RangeReader <|.. HttpRangeReader
    RangeReader <|.. BytesRangeReader
    ZipArchive --> RangeReader : depends on
```

Because `ZipArchive` depends on the interface, production wires an
`HttpRangeReader` (HTTP ranges) while tests wire a `BytesRangeReader` (a real ZIP
built in memory). The same is true for the origin fetcher, the cache, and the
clock — all injected via `Deps`. That is why the full request pipeline is tested
in plain Node with no network and no `workerd`.

---

## Request lifecycle

```mermaid
flowchart TD
    A[fetch request, env, ctx] --> B[parseConfig env]
    B --> C[resolve requestId · build Deps · Logger · Metrics]
    C --> D{{Middleware pipeline}}
    D --> E[finalizeResponse<br/>CORS + security headers + request id]
    E --> F[requestLogging<br/>structured start/completion]
    F --> G[errorBoundary<br/>try/catch → JSON error]
    G --> H[router.resolveRoute]
    H --> I{route kind}
    I -->|health/version/root| J[static handler]
    I -->|list/meta/download| K[openArchive → handler]
    J --> R[Response]
    K --> R
    R --> G --> F --> E --> Z[Response to client]
```

`finalizeResponse` is outermost so it decorates **both** success and error
responses. `errorBoundary` normalises any thrown value into a uniform JSON error
and logs it against the request id (5xx at `error`, 4xx at `warn`, client abort
at `info`).

---

## ZIP reading strategy

Which parts of a ZIP need random access vs. streaming — and how ZipStream reads
each:

| Structure                | Location               | Access        | How                                   |
| ------------------------ | ---------------------- | ------------- | ------------------------------------- |
| End of Central Directory | last ≤ 65 557 bytes    | random        | suffix range (also yields size)       |
| ZIP64 EOCD (if present)  | pointed to by locator  | random        | in tail, or one small range           |
| Central Directory        | before EOCD            | random        | one range (often within the tail)     |
| Local File Header        | before each entry      | random        | 30-byte range → data offset           |
| **Entry data**           | after its local header | **streaming** | ranged stream → passthrough / inflate |

Two subtleties this implementation gets right and many do not:

1. **The data offset must come from the local file header**, whose name/extra
   lengths frequently differ from the central directory's:
   `dataOffset = localHeaderOffset + 30 + LFH.nameLen + LFH.extraLen`.
2. **When a data descriptor is present** (general-purpose flag bit 3), the local
   header's sizes and CRC are zero — the authoritative values are in the central
   directory.

---

## Streaming pipeline

The body is assembled as a chain of `ReadableStream` transforms. Nothing is
buffered; the runtime pulls from the origin only as fast as the client drains.

```mermaid
flowchart LR
    O[Origin range<br/>compressed bytes] --> M{method?}
    M -->|STORED| P[passthrough]
    M -->|DEFLATE| D[DecompressionStream<br/>'deflate-raw']
    P --> RG{range?}
    D --> RG
    RG -->|full| CAP[slice 0..uncompressedSize<br/>caps Content-Length]
    RG -->|range STORED| OFF[origin offset shifted<br/>true random access]
    RG -->|range DEFLATE| SL[slice skip..take<br/>inflate-and-discard]
    CAP --> MT[byte meter]
    OFF --> MT
    SL --> MT
    MT --> C[(Client)]
```

- **STORED + range** shifts the origin offset — the client's byte range maps
  directly onto the origin, giving true random access (ideal for video seeking).
- **DEFLATE + range** inflates from the start and slices out the window, then
  terminates (cancelling everything upstream). This is inherent to DEFLATE and
  documented as a limitation.
- **DEFLATE full** is capped at the declared uncompressed size, so the body can
  never exceed the `Content-Length` we advertised.

Because the central directory records the uncompressed size, **`Content-Length`
is always known** — even for DEFLATE entries — so clients get accurate progress
bars and the response is never chunked.

---

## Combined ZIP (the writer)

The multi-file download inverts the read path: `zip/zip-writer.ts` repackages a
selection of entries into a **new** ZIP that streams to the client. It copies
each entry's stored bytes verbatim (a DEFLATE entry stays DEFLATE — no inflate,
no deflate) and reuses the CRC and sizes from the source central directory. The
full byte layout — every local header, the central directory, the EOCD, and any
ZIP64 records — is computed up front by a pure `planCombinedZip`, which yields an
exact `Content-Length` before a byte is sent. Data is streamed per entry via the
same `RangeReader`, so memory stays constant regardless of the selection's size.

```mermaid
flowchart LR
    SEL[selected entries] --> PLAN[planCombinedZip<br/>headers · offsets · ZIP64 · length]
    PLAN --> GEN{{async generator}}
    GEN -->|per entry| LH[local header] --> DATA[stream raw bytes from origin]
    DATA --> GEN
    GEN --> CD[central directory] --> EOCD[EOCD / ZIP64] --> C[(Client)]
```

## Cache flow

The parsed central directory is cached at three tiers, consulted fastest-first.
The cache key folds in the origin validator (ETag/Last-Modified), so a changed
archive misses instead of serving a stale index.

```mermaid
flowchart TD
    REQ[openArchive] --> PROBE[HttpRangeReader.open<br/>suffix probe → size + validators + tail]
    PROBE --> KEY[key = url + '|' + etag]
    KEY --> L1{in-isolate memo?}
    L1 -->|hit| USE[ZipArchive ready]
    L1 -->|miss| L2{Cache API / KV?}
    L2 -->|hit| REHYDRATE[parse cached CD bytes → memo] --> USE
    L2 -->|miss| PARSE[read EOCD + central directory from origin]
    PARSE --> STORE[memo.set + background Cache write] --> USE
```

- **L1 — in-isolate memo:** a bounded TTL/LRU map. Survives across requests in
  the same isolate; skips both the fetch and the parse.
- **L2 — durable store:** the per-colo Cache API (free) and, if bound, KV
  (cross-colo). Stores the central-directory bytes as a synthetic `200` (the
  Cache API refuses `206`), written in the background via `waitUntil` so it never
  delays time-to-first-byte.
- **L3 — origin:** parse once, populate both tiers.

The tail fetched by the suffix probe frequently already contains the entire
central directory, so even a cold parse usually needs **no extra origin request**
for the index.

---

## Abort & backpressure

Cancellation propagates through the whole chain:

```mermaid
flowchart LR
    CL[Client disconnects] --> RB[runtime cancels response body]
    RB --> MT[meter cancel] --> SL[slice cancel] --> DZ[DecompressionStream cancel] --> OB[origin fetch body cancel]
    OB --> AB[origin request aborted]
    subgraph signal
      RS[request.signal] -.passed to origin fetch.-> OB
    end
```

- The origin fetch is bound to `request.signal`, so a client disconnect aborts
  the upstream request immediately.
- Backpressure is native: returning a `pipeThrough` chain to the runtime means it
  pulls only as the client consumes.
- Timeouts guard only the **header** phase (TTFB); once headers arrive the timer
  is disarmed so a legitimately slow multi-gigabyte body is never killed, while
  the client-abort link stays live. See `src/utils/async.ts` and
  `src/http/fetch-with-resilience.ts`.
