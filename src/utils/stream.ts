import { concatBytes } from './bytes.js';

/**
 * A `ReadableStream` that emits `bytes` in bounded chunks and then closes. Used
 * by the in-memory {@link BytesRangeReader} and by fixtures so tests exercise
 * the same chunked/backpressured path as production.
 */
export function readableFromBytes(bytes: Uint8Array, chunkSize = 65536): ReadableStream<Uint8Array> {
  let position = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller): void {
      if (position >= bytes.byteLength) {
        controller.close();
        return;
      }
      const end = Math.min(position + chunkSize, bytes.byteLength);
      controller.enqueue(bytes.subarray(position, end));
      position = end;
    },
  });
}

/**
 * Fully read a stream into one buffer, refusing to exceed `limit` bytes. The
 * limit is a hard safety valve — it is only used for small, bounded reads (the
 * central directory, local headers), never for entry bodies, which always
 * stream straight through to the client.
 */
export async function collectStream(
  stream: ReadableStream<Uint8Array>,
  limit = Number.POSITIVE_INFINITY,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        throw new RangeError(`stream exceeded limit of ${limit} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return concatBytes(chunks);
}

/** Cancel and drain a response body so the underlying connection is released. */
export async function drainResponse(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // best-effort — the connection will be reclaimed regardless
  }
}

/**
 * Adapt an async iterable of byte chunks into a pull-based {@link ReadableStream}.
 * Pulling one chunk per `pull()` preserves backpressure, and `cancel()` calls the
 * iterator's `return()` so generators can release/cancel their upstream sources.
 * This drives the streaming ZIP writer.
 */
export function readableFromAsyncIterable(iterable: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> {
  const iterator = iterable[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller): Promise<void> {
      try {
        // Access `value` only in the not-done branch, where it narrows to
        // Uint8Array (the done branch's value has the iterator's `any` return type).
        const result = await iterator.next();
        if (result.done === true) {
          controller.close();
        } else {
          controller.enqueue(result.value);
        }
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(): Promise<void> {
      await iterator.return?.(undefined);
    },
  });
}
