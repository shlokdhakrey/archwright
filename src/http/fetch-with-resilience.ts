import { UpstreamError, UpstreamTimeoutError } from '../errors/http-error.js';
import type { Fetcher } from '../types/io.js';
import { isTimeoutError, requestAbort, sleep } from '../utils/async.js';
import { drainResponse } from '../utils/stream.js';

export interface ResilienceOptions {
  /** Maximum time to wait for response *headers* (TTFB). Body streaming is unbounded. */
  readonly timeoutMs: number;
  /** Number of automatic retries on transient failures (network/5xx/429). */
  readonly retries: number;
  /** Client signal; a client disconnect cancels the in-flight origin request. */
  readonly signal?: AbortSignal;
}

const RETRYABLE_STATUS: ReadonlySet<number> = new Set([408, 425, 429, 500, 502, 503, 504, 522, 524]);
const BASE_BACKOFF_MS = 100;
const MAX_BACKOFF_MS = 2000;

/**
 * `fetch` with per-request TTFB timeouts, bounded retries with jittered
 * exponential backoff, and correct abort semantics.
 *
 * Crucially, the timeout guards only the header phase: once headers arrive the
 * timer is disarmed so a multi-gigabyte body may stream for as long as the
 * client stays connected, while a client disconnect still aborts the origin
 * request immediately.
 */
export async function fetchWithResilience(
  fetcher: Fetcher,
  url: string,
  init: RequestInit,
  options: ResilienceOptions,
): Promise<Response> {
  const { timeoutMs, retries, signal } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) throw toError(signal.reason);

    const control = requestAbort(timeoutMs, signal);
    try {
      const response = await fetcher(url, { ...init, signal: control.signal });
      control.disarmTimeout();

      if (RETRYABLE_STATUS.has(response.status) && attempt < retries) {
        await drainResponse(response);
        control.dispose();
        lastError = new UpstreamError(`origin responded ${response.status}`, { status: response.status });
        await backoff(attempt, signal);
        continue;
      }
      // Success or a non-retryable status: return with the client-abort link
      // still live so the body stream remains cancellable.
      return response;
    } catch (error) {
      control.dispose();
      if (signal?.aborted) throw error; // client cancelled — never retry
      lastError = error;
      if (attempt < retries) {
        await backoff(attempt, signal);
        continue;
      }
      throw isTimeoutError(error)
        ? new UpstreamTimeoutError('origin timed out', error)
        : new UpstreamError('origin request failed', undefined, error);
    }
  }

  throw lastError instanceof Error ? lastError : new UpstreamError();
}

async function backoff(attempt: number, signal?: AbortSignal): Promise<void> {
  const ceiling = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt);
  const delay = ceiling / 2 + Math.floor(Math.random() * (ceiling / 2 + 1));
  await sleep(delay, signal);
}

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new DOMException('Aborted', 'AbortError');
}
