/**
 * Native byte pumps.
 *
 * Moving bytes through a *web-standard* `TransformStream` (or an async
 * generator) routes every chunk through the JS isolate, which on Workers costs
 * roughly 17 ms of CPU per MB — enough to exhaust the Free-plan budget at about
 * 115 MB. The runtime also exposes `FixedLengthStream` and
 * `IdentityTransformStream`, which are implemented natively: bytes never enter
 * the isolate and the same 50 MB costs ~1 ms. Measured, for 50 MB:
 *
 * | sink                              | CPU     |
 * | --------------------------------- | ------- |
 * | `FixedLengthStream` + `pipeTo`    |    1 ms |
 * | `IdentityTransformStream`         |    2 ms |
 * | web `TransformStream`             |  886 ms |
 *
 * So anything that concatenates streams (the ZIP/TAR writers) must use these and
 * move entry bodies with `pipeTo`, never by re-yielding chunks. Small headers
 * written from JS are negligible.
 *
 * Node (used by the test suite) has neither global, so we fall back to the
 * standard `TransformStream` — correct everywhere, fast on Workers.
 */

/** The pair returned by every sink: a readable to serve, a writable to fill. */
export interface BytePipe {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
}

interface NativeGlobals {
  FixedLengthStream?: new (length: number | bigint) => BytePipe;
  IdentityTransformStream?: new () => BytePipe;
}

/**
 * A byte pipe that copies natively where the runtime supports it.
 *
 * Pass `totalBytes` when the exact output size is known: `FixedLengthStream`
 * both pumps natively and asserts the promised length was delivered, turning a
 * truncated body into a loud error instead of a silently short file.
 */
export function createBytePipe(totalBytes?: number): BytePipe {
  const globals = globalThis as unknown as NativeGlobals;
  if (totalBytes !== undefined && typeof globals.FixedLengthStream === 'function') {
    return new globals.FixedLengthStream(totalBytes);
  }
  if (typeof globals.IdentityTransformStream === 'function') {
    return new globals.IdentityTransformStream();
  }
  return new TransformStream<Uint8Array, Uint8Array>();
}

/** True when the runtime can move bytes without passing them through JS. */
export function hasNativePipe(): boolean {
  const globals = globalThis as unknown as NativeGlobals;
  return (
    typeof globals.FixedLengthStream === 'function' ||
    typeof globals.IdentityTransformStream === 'function'
  );
}

/** Write one small buffer (a header/trailer), briefly borrowing the writer. */
export async function writeChunk(writable: WritableStream<Uint8Array>, chunk: Uint8Array): Promise<void> {
  const writer = writable.getWriter();
  try {
    await writer.write(chunk);
  } finally {
    writer.releaseLock();
  }
}

/**
 * Move a whole body into `writable` **natively** — the payload never enters the
 * isolate. `preventClose` keeps the sink open for the next entry.
 */
export async function pumpBody(
  writable: WritableStream<Uint8Array>,
  body: ReadableStream<Uint8Array>,
): Promise<void> {
  await body.pipeTo(writable, { preventClose: true });
}

/** Close the sink, signalling a complete archive. */
export async function closePipe(writable: WritableStream<Uint8Array>): Promise<void> {
  const writer = writable.getWriter();
  try {
    await writer.close();
  } finally {
    writer.releaseLock();
  }
}
