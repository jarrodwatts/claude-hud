import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSignature, EMPTY_VERIFY } from '../dist/verify.js';

// ── parseSignature ──────────────────────────────────────────────────

test('parseSignature returns EMPTY_VERIFY for empty string', () => {
  const result = parseSignature('');
  assert.deepEqual(result, EMPTY_VERIFY);
});

test('parseSignature returns EMPTY_VERIFY for invalid base64', () => {
  const result = parseSignature('!!!not-base64!!!');
  assert.deepEqual(result, EMPTY_VERIFY);
});

test('parseSignature returns EMPTY_VERIFY for very short data', () => {
  // Less than 20 bytes after decoding
  const short = Buffer.from(new Uint8Array(10)).toString('base64');
  const result = parseSignature(short);
  assert.deepEqual(result, EMPTY_VERIFY);
});

test('parseSignature detects legacy format when first byte is not 0x12', () => {
  // 30 bytes of data starting with 0xFF (not 0x12)
  const buf = new Uint8Array(30);
  buf[0] = 0xFF;
  const b64 = Buffer.from(buf).toString('base64');
  const result = parseSignature(b64);
  assert.equal(result.hasSig, true);
  assert.equal(result.format, 'legacy');
  assert.equal(result.keyLen, 0);
  assert.equal(result.keyId, null);
  assert.equal(result.sigVersion, null);
});

test('parseSignature decodes protobuf_v2 with valid structure', () => {
  // Build a minimal protobuf structure:
  // outer: field 2 (tag=0x12) with length-delimited content
  //   inner: field 1 (tag=0x0a) with identity block
  //     field 1 (varint): keyId = 11
  //     field 3 (varint): sigVersion = 2
  //     field 5 (bytes): 64-byte key

  // Identity block inner fields
  const identityParts = [];
  // field 1, varint, value 11
  identityParts.push(0x08, 11);
  // field 3, varint, value 2
  identityParts.push(0x18, 2);
  // field 5, length-delimited, 64 bytes
  identityParts.push(0x2a, 64);
  for (let i = 0; i < 64; i++) identityParts.push(0xAB);

  const identityBlock = new Uint8Array(identityParts);

  // Wrap in inner field 1 (tag=0x0a)
  const innerParts = [];
  innerParts.push(0x0a, identityBlock.length);
  for (const b of identityBlock) innerParts.push(b);
  // field 2 (nonce): 12 bytes
  innerParts.push(0x12, 12);
  for (let i = 0; i < 12; i++) innerParts.push(0x00);

  const innerBlock = new Uint8Array(innerParts);

  // Wrap in outer field 2 (tag=0x12)
  const outerParts = [];
  outerParts.push(0x12, innerBlock.length);
  for (const b of innerBlock) outerParts.push(b);

  const fullBuf = new Uint8Array(outerParts);
  const b64 = Buffer.from(fullBuf).toString('base64');

  const result = parseSignature(b64);
  assert.equal(result.hasSig, true);
  assert.equal(result.format, 'protobuf_v2');
  assert.equal(result.keyLen, 64);
  assert.equal(result.keyId, 11);
  assert.equal(result.sigVersion, 2);
});

test('parseSignature handles protobuf with different key rotation ID', () => {
  // Same structure but keyId = 12
  const identityParts = [];
  identityParts.push(0x08, 12); // field 1 = 12
  identityParts.push(0x18, 2);  // field 3 = 2
  identityParts.push(0x2a, 64); // field 5 = 64 bytes
  for (let i = 0; i < 64; i++) identityParts.push(0xCD);

  const identityBlock = new Uint8Array(identityParts);
  const innerParts = [];
  innerParts.push(0x0a, identityBlock.length);
  for (const b of identityBlock) innerParts.push(b);
  innerParts.push(0x12, 12);
  for (let i = 0; i < 12; i++) innerParts.push(0x00);

  const innerBlock = new Uint8Array(innerParts);
  const outerParts = [];
  outerParts.push(0x12, innerBlock.length);
  for (const b of innerBlock) outerParts.push(b);

  const result = parseSignature(Buffer.from(new Uint8Array(outerParts)).toString('base64'));
  assert.equal(result.format, 'protobuf_v2');
  assert.equal(result.keyId, 12);
  assert.equal(result.keyLen, 64);
});

test('EMPTY_VERIFY has correct default values', () => {
  assert.equal(EMPTY_VERIFY.hasSig, false);
  assert.equal(EMPTY_VERIFY.format, 'none');
  assert.equal(EMPTY_VERIFY.keyLen, 0);
  assert.equal(EMPTY_VERIFY.keyId, null);
  assert.equal(EMPTY_VERIFY.sigVersion, null);
});

// ── renderVerifyLine ────────────────────────────────────────────────

test('renderVerifyLine returns null when showVerify is false', async () => {
  const { renderVerifyLine } = await import('../dist/render/lines/verify.js');
  const ctx = {
    config: { display: { showVerify: false } },
    transcript: {},
  };
  assert.equal(renderVerifyLine(ctx), null);
});

test('renderVerifyLine returns null when no verify data', async () => {
  const { renderVerifyLine } = await import('../dist/render/lines/verify.js');
  const ctx = {
    config: { display: {} },
    transcript: {},
  };
  assert.equal(renderVerifyLine(ctx), null);
});

test('renderVerifyLine renders green Verified for protobuf_v2 + 64B key', async () => {
  const { renderVerifyLine } = await import('../dist/render/lines/verify.js');
  const ctx = {
    config: { display: {} },
    transcript: {
      verify: {
        hasSig: true,
        format: 'protobuf_v2',
        keyLen: 64,
        keyId: 11,
        sigVersion: 2,
      },
    },
  };
  const line = renderVerifyLine(ctx);
  assert.ok(line, 'should return a line');
  assert.ok(line.includes('Verified'), 'should contain "Verified"');
  assert.ok(line.includes('4.6+'), 'should contain version indicator');
});

test('renderVerifyLine renders Legacy for legacy format', async () => {
  const { renderVerifyLine } = await import('../dist/render/lines/verify.js');
  const ctx = {
    config: { display: {} },
    transcript: {
      verify: {
        hasSig: true,
        format: 'legacy',
        keyLen: 0,
        keyId: null,
        sigVersion: null,
      },
    },
  };
  const line = renderVerifyLine(ctx);
  assert.ok(line, 'should return a line');
  assert.ok(line.includes('Legacy'), 'should contain "Legacy"');
  assert.ok(line.includes('4.5'), 'should contain version 4.5');
});
