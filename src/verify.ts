/**
 * API authenticity verification via Anthropic thinking-block signatures.
 *
 * Claude 4.6+ responses include a protobuf-encoded cryptographic signature
 * on every thinking block. The structure proves the response originated from
 * Anthropic's servers — a third-party proxy serving GPT/Gemini/GLM cannot
 * produce these signatures.
 *
 * Protobuf layout (Claude 4.6+):
 *   outer field 2 {
 *     field 1 (identity block) {
 *       field 1  varint  — signing key rotation ID
 *       field 3  varint  — signature version (2)
 *       field 5  bytes   — 64-byte crypto key
 *     }
 *     field 2  bytes  — 12-byte nonce
 *     [remaining: signed payload]
 *   }
 *
 * What it proves:
 *   ✓ Response came from Anthropic (not GPT/Gemini/GLM)
 *   ✓ Claude 4.6 vs 4.5 (protobuf vs legacy format)
 *
 * What it cannot prove:
 *   ✗ Opus vs Sonnet vs Haiku (signing key ID is shared across tiers)
 */

export type SigFormat = 'protobuf_v2' | 'legacy' | 'none';

export interface VerifyData {
  /** Whether any thinking signature was found in the latest response. */
  hasSig: boolean;
  /** Signature format: protobuf_v2 (4.6+), legacy (4.5), or none. */
  format: SigFormat;
  /** Length of the crypto key in bytes (64 for valid sigs). */
  keyLen: number;
  /** Signing key rotation ID (not a model identifier). */
  keyId: number | null;
  /** Signature protocol version. */
  sigVersion: number | null;
}

export const EMPTY_VERIFY: VerifyData = {
  hasSig: false,
  format: 'none',
  keyLen: 0,
  keyId: null,
  sigVersion: null,
};

// ── Protobuf helpers ────────────────────────────────────────────────

function readVarint(buf: Uint8Array, pos: number): [number, number] {
  let val = 0;
  let shift = 0;
  while (pos < buf.length) {
    const b = buf[pos++];
    val |= (b & 0x7F) << shift;
    shift += 7;
    if ((b & 0x80) === 0) break;
  }
  return [val, pos];
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Parse a base64-encoded thinking-block signature and extract
 * authenticity indicators.
 */
export function parseSignature(sigBase64: string): VerifyData {
  let raw: Uint8Array;
  try {
    raw = Uint8Array.from(Buffer.from(sigBase64, 'base64'));
  } catch {
    return EMPTY_VERIFY;
  }

  if (raw.length < 20) {
    return EMPTY_VERIFY;
  }

  // Legacy format (Claude 4.5 and earlier) — no protobuf wrapper
  if (raw[0] !== 0x12) {
    return {
      hasSig: true,
      format: 'legacy',
      keyLen: 0,
      keyId: null,
      sigVersion: null,
    };
  }

  // Claude 4.6+ protobuf: outer field 2 (tag = 0x12)
  let pos: number;
  [, pos] = readVarint(raw, 1); // skip outer length

  // Expect inner field 1 (tag = 0x0a)
  if (pos >= raw.length || raw[pos] !== 0x0a) {
    return { hasSig: true, format: 'legacy', keyLen: 0, keyId: null, sigVersion: null };
  }
  pos += 1;

  let f1Len: number;
  [f1Len, pos] = readVarint(raw, pos);
  const f1End = pos + f1Len;
  if (f1End > raw.length) {
    return { hasSig: true, format: 'legacy', keyLen: 0, keyId: null, sigVersion: null };
  }

  // Parse identity block inner fields
  let keyId: number | null = null;
  let sigVersion: number | null = null;
  let keyLen = 0;

  let ipos = pos;
  while (ipos < f1End) {
    const tag = raw[ipos++];
    const fn = tag >> 3;
    const wt = tag & 0x07;

    if (wt === 0) {
      // varint
      let val: number;
      [val, ipos] = readVarint(raw, ipos);
      if (fn === 1) keyId = val;
      if (fn === 3) sigVersion = val;
    } else if (wt === 2) {
      // length-delimited
      let blen: number;
      [blen, ipos] = readVarint(raw, ipos);
      if (fn === 5) keyLen = blen;
      ipos += blen;
    } else {
      break;
    }
  }

  return {
    hasSig: true,
    format: 'protobuf_v2',
    keyLen,
    keyId,
    sigVersion,
  };
}
