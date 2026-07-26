#!/usr/bin/env node
// Inspect a remote ZIP archive over HTTP range requests, without downloading it.
//
//   node scripts/probe-archive.mjs <url>
//
// Prints the archive size, ZIP64 status, and a table of entries (method, sizes,
// CRC). This is the same technique the Worker uses, useful for verifying that an
// origin supports range requests and for eyeballing an archive's contents.

const EOCD_SIG = 0x06054b50;
const EOCD64_SIG = 0x06064b50;
const EOCD64_LOC_SIG = 0x07064b50;
const CDH_SIG = 0x02014b50;
const SEARCH_WINDOW = 65557;

const url = process.argv[2];
if (!url) {
  console.error('Usage: node scripts/probe-archive.mjs <url>');
  process.exit(1);
}

const dv = (buf) => new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

async function range(start, end) {
  const res = await fetch(url, {
    headers: { Range: `bytes=${start}-${end}`, 'Accept-Encoding': 'identity' },
  });
  if (res.status !== 206 && res.status !== 200) throw new Error(`unexpected status ${res.status}`);
  return { bytes: Buffer.from(await res.arrayBuffer()), status: res.status, headers: res.headers };
}

async function main() {
  const probe = await fetch(url, { headers: { Range: `bytes=-${SEARCH_WINDOW}` } });
  if (probe.status !== 206) {
    throw new Error(
      `origin did not honour a suffix range (status ${probe.status}); it may not support ranges`,
    );
  }
  const contentRange = probe.headers.get('content-range');
  const total = Number(contentRange.split('/')[1]);
  const tail = Buffer.from(await probe.arrayBuffer());
  const tailStart = total - tail.byteLength;

  console.log(`URL           : ${url}`);
  console.log(`Size          : ${total.toLocaleString()} bytes`);
  console.log(`ETag          : ${probe.headers.get('etag') ?? '(none)'}`);
  console.log(`Last-Modified : ${probe.headers.get('last-modified') ?? '(none)'}`);

  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (dv(tail).getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('EOCD not found in tail');

  let entryCount = dv(tail).getUint16(eocd + 10, true);
  let cdSize = dv(tail).getUint32(eocd + 12, true);
  let cdOffset = dv(tail).getUint32(eocd + 16, true);
  let zip64 = false;

  const locOff = eocd - 20;
  if (locOff >= 0 && dv(tail).getUint32(locOff, true) === EOCD64_LOC_SIG) {
    zip64 = true;
    const eocd64Abs = Number(dv(tail).getBigUint64(locOff + 8, true));
    const rec =
      eocd64Abs >= tailStart
        ? tail.subarray(eocd64Abs - tailStart, eocd64Abs - tailStart + 56)
        : (await range(eocd64Abs, eocd64Abs + 55)).bytes;
    if (dv(rec).getUint32(0, true) !== EOCD64_SIG) throw new Error('bad ZIP64 EOCD signature');
    entryCount = Number(dv(rec).getBigUint64(32, true));
    cdSize = Number(dv(rec).getBigUint64(40, true));
    cdOffset = Number(dv(rec).getBigUint64(48, true));
  }

  console.log(`ZIP64         : ${zip64}`);
  console.log(`Entries       : ${entryCount}`);
  console.log('');

  const cd =
    cdOffset >= tailStart
      ? tail.subarray(cdOffset - tailStart, cdOffset - tailStart + cdSize)
      : (await range(cdOffset, cdOffset + cdSize - 1)).bytes;

  const view = dv(cd);
  let p = 0;
  const methods = { 0: 'stored', 8: 'deflate' };
  console.log('method   size            compressed      crc32     name');
  console.log('-------- --------------- --------------- --------- ----------------------------------------');
  for (let i = 0; i < entryCount && p + 46 <= cd.byteLength; i++) {
    if (view.getUint32(p, true) !== CDH_SIG) break;
    const method = view.getUint16(p + 10, true);
    let comp = view.getUint32(p + 20, true);
    let uncomp = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const crc = view.getUint32(p + 16, true) >>> 0;
    const name = cd.subarray(p + 46, p + 46 + nameLen).toString('utf8');

    const extra = cd.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen);
    let ep = 0;
    while (ep + 4 <= extra.byteLength) {
      const id = dv(extra).getUint16(ep, true);
      const sz = dv(extra).getUint16(ep + 2, true);
      if (id === 0x0001) {
        let q = ep + 4;
        if (uncomp === 0xffffffff) {
          uncomp = Number(dv(extra).getBigUint64(q, true));
          q += 8;
        }
        if (comp === 0xffffffff) {
          comp = Number(dv(extra).getBigUint64(q, true));
          q += 8;
        }
      }
      ep += 4 + sz;
    }

    console.log(
      `${(methods[method] ?? `m${method}`).padEnd(8)} ${String(uncomp).padStart(15)} ${String(comp).padStart(15)} ${crc.toString(16).padStart(8, '0')}  ${name}`,
    );
    p += 46 + nameLen + extraLen + commentLen;
  }
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
