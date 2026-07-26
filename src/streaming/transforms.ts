/**
 * Small, composable `TransformStream`s used to shape entry bodies. Each one is
 * chunk-boundary correct and preserves native backpressure.
 */

/**
 * Drop the first `skip` bytes, emit the next `take` bytes, then terminate —
 * cancelling everything upstream. This is how a `Range` over a DEFLATE entry is
 * served: inflate from the beginning, discard up to the range start, emit the
 * window, and stop (which halts further inflation and the origin fetch).
 */
export function sliceStream(skip: number, take: number): TransformStream<Uint8Array, Uint8Array> {
  let remainingSkip = skip;
  let remainingTake = take;

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller): void {
      if (remainingTake <= 0) {
        controller.terminate();
        return;
      }

      let data = chunk;
      if (remainingSkip > 0) {
        if (data.byteLength <= remainingSkip) {
          remainingSkip -= data.byteLength;
          return;
        }
        data = data.subarray(remainingSkip);
        remainingSkip = 0;
      }

      if (data.byteLength >= remainingTake) {
        controller.enqueue(data.subarray(0, remainingTake));
        remainingTake = 0;
        controller.terminate();
        return;
      }

      controller.enqueue(data);
      remainingTake -= data.byteLength;
    },
  });
}

/**
 * A pass-through that counts the bytes flowing through it and reports the total
 * when the stream completes normally. Used for the `bytes_streamed` metric.
 */
export function meterStream(onComplete: (bytes: number) => void): TransformStream<Uint8Array, Uint8Array> {
  let total = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller): void {
      total += chunk.byteLength;
      controller.enqueue(chunk);
    },
    flush(): void {
      onComplete(total);
    },
  });
}
