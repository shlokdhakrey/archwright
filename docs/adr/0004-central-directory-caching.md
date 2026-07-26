# 0004 — Three-tier central-directory cache

**Status:** Accepted

## Context

Every request must know the archive's index (central directory). Re-fetching and
re-parsing it on each request wastes origin subrequests and CPU, especially for
archives with large directories.

## Decision

Cache the parsed/serialised central directory in three tiers, consulted
fastest-first, keyed by `archiveUrl + '|' + validator(ETag/Last-Modified)`:

1. **In-isolate memo** — bounded TTL/LRU map; skips fetch _and_ parse.
2. **Durable store** — per-colo Cache API (free), plus KV if bound (cross-colo).
   Stored as a synthetic `200` because the Cache API rejects `206`.
3. **Origin** — parse once, populate both tiers; the Cache write happens in the
   background via `waitUntil`.

## Consequences

- Warm requests skip index work entirely; cold requests usually parse from the
  tail already fetched by the suffix probe (no extra origin call).
- Folding the validator into the key gives automatic invalidation: a changed
  archive changes the key and misses, rather than serving a stale index.
- Background cache writes never delay time-to-first-byte.
- The memo is isolate-local, so cross-isolate consistency relies on the durable
  tier; acceptable for an index that changes only when the archive does.

## Alternatives considered

- **No cache:** simplest, but repeated fetch+parse cost. Rejected.
- **Cache the raw `206` tail:** the Cache API refuses `206`; storing a synthetic
  `200` of the CD bytes is cleaner and smaller.
