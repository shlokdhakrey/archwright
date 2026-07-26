#!/usr/bin/env node
// Smoke-test a deployed ZipStream Worker end to end.
//
//   node scripts/smoke.mjs <workerBaseUrl> <entryPath>
//
// Verifies health, version, HEAD, and a byte-range GET. Exits non-zero on the
// first failure, so it is CI-friendly.

const [base, entryPath] = process.argv.slice(2);
if (!base || !entryPath) {
  console.error('Usage: node scripts/smoke.mjs <workerBaseUrl> <entryPath>');
  process.exit(1);
}

const root = base.replace(/\/+$/, '');
let failures = 0;

function check(name, condition, detail = '') {
  const status = condition ? 'PASS' : 'FAIL';
  if (!condition) failures += 1;
  console.log(`[${status}] ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  const health = await fetch(`${root}/__/health`);
  check('health returns 200', health.status === 200, `status ${health.status}`);

  const version = await fetch(`${root}/__/version`);
  check('version returns 200', version.status === 200, `status ${version.status}`);

  const head = await fetch(`${root}/${entryPath}`, { method: 'HEAD' });
  const length = Number(head.headers.get('content-length'));
  check('HEAD returns 200', head.status === 200, `status ${head.status}`);
  check('HEAD advertises Accept-Ranges: bytes', head.headers.get('accept-ranges') === 'bytes');
  check('HEAD reports a Content-Length', Number.isFinite(length) && length > 0, `length ${length}`);

  const wanted = Math.min(1024, Math.max(1, length)) - 1;
  const ranged = await fetch(`${root}/${entryPath}`, { headers: { Range: `bytes=0-${wanted}` } });
  const body = new Uint8Array(await ranged.arrayBuffer());
  check('range GET returns 206', ranged.status === 206, `status ${ranged.status}`);
  check('range GET has a Content-Range', ranged.headers.get('content-range') !== null);
  check('range GET body length matches', body.byteLength === wanted + 1, `got ${body.byteLength}`);

  console.log('');
  if (failures > 0) {
    console.error(`${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('All smoke checks passed.');
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
