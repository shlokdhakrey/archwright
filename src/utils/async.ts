/** Async/abort primitives for the origin fetch path. */

/**
 * A composite abort controller for a single origin request. It aborts when the
 * per-request timeout fires *or* when the linked (client) signal aborts.
 *
 * The distinction between {@link RequestAbort.disarmTimeout | disarmTimeout} and
 * {@link RequestAbort.dispose | dispose} is what makes long streaming safe: once
 * the response *headers* have arrived we disarm the timeout timer (so a
 * legitimately slow multi-gigabyte body is never killed by it) while keeping the
 * client-disconnect link live for the whole life of the body stream.
 */
export interface RequestAbort {
  readonly signal: AbortSignal;
  /** Stop the header/TTFB timeout while leaving the client link active. */
  disarmTimeout(): void;
  /** Fully tear down the timer and the client-abort listener. */
  dispose(): void;
}

export function requestAbort(timeoutMs: number, linked?: AbortSignal): RequestAbort {
  const controller = new AbortController();

  const onLinkedAbort = (): void => {
    controller.abort(linked?.reason);
  };

  if (linked) {
    if (linked.aborted) {
      controller.abort(linked.reason);
    } else {
      linked.addEventListener('abort', onLinkedAbort, { once: true });
    }
  }

  let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
    controller.abort(new DOMException(`Operation timed out after ${timeoutMs}ms`, 'TimeoutError'));
  }, timeoutMs);

  const disarmTimeout = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  return {
    signal: controller.signal,
    disarmTimeout,
    dispose(): void {
      disarmTimeout();
      linked?.removeEventListener('abort', onLinkedAbort);
    },
  };
}

/** True when an error represents an abort or timeout (client disconnect etc.). */
export function isAbortError(error: unknown): boolean {
  const name = errorName(error);
  return name === 'AbortError' || name === 'TimeoutError';
}

/** True when an error was specifically caused by a timeout. */
export function isTimeoutError(error: unknown): boolean {
  return errorName(error) === 'TimeoutError';
}

function errorName(error: unknown): string | undefined {
  if (error instanceof Error) return error.name;
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const name = (error as { name?: unknown }).name;
    return typeof name === 'string' ? name : undefined;
  }
  return undefined;
}

/** Resolve after `ms`, rejecting early if `signal` aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortReason(signal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function abortReason(signal?: AbortSignal): Error {
  const reason: unknown = signal?.reason;
  return reason instanceof Error ? reason : new DOMException('Aborted', 'AbortError');
}
