/**
 * A tiny TTL + LRU map. Time is passed in (never read from a global clock) so it
 * stays deterministic and testable. Used as the in-isolate L1 for parsed central
 * directories, which lets repeat requests to the same archive skip both the
 * origin fetch and the parse.
 */
export class TtlLruCache<V> {
  private readonly map = new Map<string, { value: V; expiresAt: number }>();

  constructor(private readonly maxEntries = 32) {}

  get(key: string, now: number): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (now > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V, expiresAt: number): void {
    if (!this.map.has(key) && this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { value, expiresAt });
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}
