/** A flat, JSON-serialisable view of everything measured during a request. */
export interface MetricsSnapshot {
  readonly timings: Readonly<Record<string, number>>;
  readonly counters: Readonly<Record<string, number>>;
  readonly gauges: Readonly<Record<string, number>>;
}

/** Records timings, counters and gauges for a single request. */
export interface MetricsRecorder {
  /** Record a duration in milliseconds under `name`. */
  timing(name: string, ms: number): void;
  /** Start a timer; the returned function stops it and records the elapsed ms. */
  startTimer(name: string): () => number;
  /** Add `value` (default 1) to a counter. */
  count(name: string, value?: number): void;
  /** Set a gauge to an absolute `value`. */
  gauge(name: string, value: number): void;
  /** Immutable view of the accumulated metrics. */
  snapshot(): MetricsSnapshot;
}
