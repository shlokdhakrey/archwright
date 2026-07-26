import type { Clock } from '../types/io.js';
import type { MetricsRecorder, MetricsSnapshot } from '../types/metrics.js';

/**
 * A per-request metrics recorder. It accumulates timings, counters and gauges in
 * plain objects and produces an immutable snapshot for the request-completed log
 * line (and, optionally, Analytics Engine).
 */
export function createMetricsRecorder(clock: Clock): MetricsRecorder {
  const timings: Record<string, number> = {};
  const counters: Record<string, number> = {};
  const gauges: Record<string, number> = {};

  return {
    timing(name: string, ms: number): void {
      timings[name] = ms;
    },
    startTimer(name: string): () => number {
      const start = clock.now();
      return (): number => {
        const elapsed = clock.now() - start;
        timings[name] = elapsed;
        return elapsed;
      };
    },
    count(name: string, value = 1): void {
      counters[name] = (counters[name] ?? 0) + value;
    },
    gauge(name: string, value: number): void {
      gauges[name] = value;
    },
    snapshot(): MetricsSnapshot {
      return {
        timings: { ...timings },
        counters: { ...counters },
        gauges: { ...gauges },
      };
    },
  };
}
