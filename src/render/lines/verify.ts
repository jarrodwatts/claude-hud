import type { RenderContext } from '../../types.js';
import type { SigFormat } from '../../verify.js';
import { dim, RESET } from '../colors.js';

function formatBadge(format: SigFormat, keyLen: number): string {
  if (format === 'protobuf_v2' && keyLen === 64) {
    return `\x1b[32mVerified\x1b[0m`;  // green
  }
  if (format === 'protobuf_v2') {
    return `\x1b[33mPartial\x1b[0m`;   // yellow — protobuf but unusual key
  }
  if (format === 'legacy') {
    return `\x1b[33mLegacy\x1b[0m`;    // yellow — older sig format
  }
  return `\x1b[90mN/A\x1b[0m`;         // dim — no thinking block
}

function formatVersion(format: SigFormat): string {
  if (format === 'protobuf_v2') return '4.6+';
  if (format === 'legacy') return '4.5';
  return '';
}

export function renderVerifyLine(ctx: RenderContext): string | null {
  const display = ctx.config?.display;
  if (display?.showVerify === false) {
    return null;
  }

  const verify = ctx.transcript.verify;
  if (!verify) {
    return null;
  }

  const badge = formatBadge(verify.format, verify.keyLen);
  const version = formatVersion(verify.format);

  let line = `${dim('Origin')} ${badge}`;

  if (version) {
    line += dim(` (${version})`);
  }

  return line;
}
