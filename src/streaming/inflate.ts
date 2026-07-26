/**
 * Streaming DEFLATE decompression via the runtime's native
 * `DecompressionStream`. ZIP method 8 is *raw* DEFLATE (RFC 1951, no zlib
 * header/trailer), which is exactly the `'deflate-raw'` format.
 *
 * Using the native implementation means decompression is C++/zlib-fast, adds
 * zero bytes to the bundle, and preserves backpressure end to end: it only pulls
 * from the origin as fast as the client drains the response.
 */
export function inflateRaw(source: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  return source.pipeThrough(new DecompressionStream('deflate-raw'));
}
