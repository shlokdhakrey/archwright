#!/usr/bin/env node
// Generate a signed archive reference for multi-archive mode.
//
//   node scripts/sign-ref.mjs <secret> <archiveUrl> [expiresInSeconds]
//
// The token format matches src/security/signing.ts exactly:
//   base64url(JSON{u,e?}) + "." + base64url(HMAC-SHA256(payload))

const [secret, archiveUrl, ttl] = process.argv.slice(2);
if (!secret || !archiveUrl) {
  console.error('Usage: node scripts/sign-ref.mjs <secret> <archiveUrl> [expiresInSeconds]');
  process.exit(1);
}

const enc = new TextEncoder();

function bytesToBase64Url(bytes) {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function stringToBase64Url(value) {
  return bytesToBase64Url(enc.encode(value));
}

async function main() {
  const payload = ttl
    ? JSON.stringify({ u: archiveUrl, e: Date.now() + Number(ttl) * 1000 })
    : JSON.stringify({ u: archiveUrl });
  const payloadB64 = stringToBase64Url(payload);

  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(payloadB64)));
  const token = `${payloadB64}.${bytesToBase64Url(sig)}`;

  console.log(token);
  console.log('');
  console.log(`Example: https://<your-worker>/a/${token}/<entryPath>`);
  if (ttl) console.log(`Expires: ${new Date(Date.now() + Number(ttl) * 1000).toISOString()}`);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
