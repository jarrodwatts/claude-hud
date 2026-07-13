import { sanitizeDisplayText } from './utils/sanitize.js';

export const TRANSCRIPT_MODEL_MAX_LEN = 80;

/**
 * Normalize model IDs read from transcripts or their cache before display.
 * Proxy-provided model values are untrusted terminal input, so strip ANSI,
 * OSC, control, and bidi sequences and keep the retained value bounded.
 */
export function sanitizeTranscriptModel(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const sanitized = sanitizeDisplayText(value).trim().slice(0, TRANSCRIPT_MODEL_MAX_LEN);
  return sanitized || undefined;
}
