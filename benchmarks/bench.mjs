#!/usr/bin/env node
// Micro-benchmark of the streaming primitives ZipStream is built on:
//   - native raw-DEFLATE decompression throughput (DecompressionStream)
//   - constant memory while producing arbitrarily large logical output
//
//   node benchmarks/bench.mjs [sizesInMB...]
//
// Because compressible input decompresses to a large output that we stream and
// discard, peak RSS stays flat regardless of logical size — the same property
// that lets the Worker serve multi-gigabyte entries in 128 MB.

const MB = 1024 * 1024;
const sizes = process.argv
  .slice(2)
  .map(Number)
  .filter((n) => n > 0);
const SIZES_MB = sizes.length > 0 ? sizes : [1, 10, 50, 100, 500];
const CHUNK = 64 * 1024;

function patternStream(totalBytes) {
  let produced = 0;
  const chunk = new Uint8Array(CHUNK);
  for (let i = 0; i < CHUNK; i++) chunk[i] = (i * 31 + 7) & 0xff; // compressible
  return new ReadableStream({
    pull(controller) {
      if (produced >= totalBytes) return controller.close();
      const remaining = totalBytes - produced;
      const slice = remaining >= CHUNK ? chunk : chunk.subarray(0, remaining);
      controller.enqueue(slice);
      produced += slice.byteLength;
    },
  });
}

async function collectToBuffer(stream) {
  const chunks = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
}

async function drainCounting(stream) {
  let total = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength; // discard the chunk; never accumulate
  }
  return total;
}

function now() {
  return Number(process.hrtime.bigint() / 1000n) / 1000; // ms
}

async function main() {
  console.log('Streaming raw-DEFLATE decompression benchmark (native DecompressionStream)\n');
  console.log('   logical    compressed   inflate throughput   peak RSS Δ');
  console.log('---------- ------------- -------------------- ------------');

  const baselineRss = process.memoryUsage().rss;
  let peakRss = baselineRss;

  for (const mb of SIZES_MB) {
    const totalBytes = mb * MB;

    const compressed = await collectToBuffer(
      patternStream(totalBytes).pipeThrough(new CompressionStream('deflate-raw')),
    );

    if (global.gc) global.gc();
    const start = now();
    const source = new Response(compressed).body.pipeThrough(new DecompressionStream('deflate-raw'));
    const produced = await drainCounting(source);
    const elapsed = now() - start;

    peakRss = Math.max(peakRss, process.memoryUsage().rss);
    const mbps = produced / MB / (elapsed / 1000);

    console.log(
      `${String(mb).padStart(7)}MB ${String((compressed.byteLength / MB).toFixed(2)).padStart(10)}MB ${mbps
        .toFixed(0)
        .padStart(15)} MB/s ${((peakRss - baselineRss) / MB).toFixed(1).padStart(9)}MB`,
    );

    if (produced !== totalBytes) {
      throw new Error(`decompressed size mismatch: ${produced} !== ${totalBytes}`);
    }
  }

  console.log('\nNote: peak RSS stays flat as logical size grows — output is streamed, never buffered.');
  console.log('Run with `node --expose-gc benchmarks/bench.mjs` for cleaner memory numbers.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
