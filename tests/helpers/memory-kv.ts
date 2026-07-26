/**
 * A minimal in-memory stand-in for a Workers KV namespace — enough of the
 * surface (get/put text values, TTL is accepted and ignored) for the short-link
 * tests to exercise the real handlers without a live binding.
 */
export class MemoryKv {
  private readonly store = new Map<string, string>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.store.get(key) ?? null);
  }

  put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
    return Promise.resolve();
  }

  /** Test-only: number of stored keys. */
  size(): number {
    return this.store.size;
  }
}

/** A `MemoryKv` typed as a `KVNamespace` for injection through `Env`. */
export function memoryKv(): KVNamespace {
  return new MemoryKv() as unknown as KVNamespace;
}
