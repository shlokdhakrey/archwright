#!/usr/bin/env node
// Fail CI if the built Worker bundle exceeds a gzip-size budget. The Free plan
// allows 3 MB gzipped; we hold ourselves to a far tighter budget to keep cold
// starts fast and dependencies honest.

import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';
const MAX_GZIP_BYTES = 512 * 1024; // 512 KiB

if (!existsSync(DIST)) {
  console.error(`No ${DIST}/ directory. Run \`npm run build\` first.`);
  process.exit(1);
}

let total = 0;
for (const file of readdirSync(DIST)) {
  if (!file.endsWith('.js')) continue;
  total += gzipSync(readFileSync(join(DIST, file))).byteLength;
}

const kib = (total / 1024).toFixed(1);
console.log(`Bundle gzip size: ${kib} KiB (budget ${(MAX_GZIP_BYTES / 1024).toFixed(0)} KiB)`);

if (total > MAX_GZIP_BYTES) {
  console.error(`Bundle exceeds the ${(MAX_GZIP_BYTES / 1024).toFixed(0)} KiB budget.`);
  process.exit(1);
}
