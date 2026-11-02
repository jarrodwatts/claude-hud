import { displayLabel } from './utils/sanitize.ts';

export const TRANSCRIPT_MODEL_MAX_LEN = 80;

/**
 * Normalize model IDs read from transcripts or their cache before display.
 * Proxy-provided model values are untrusted terminal input, so strip ANSI,
 * OSC, control, and bidi sequences and keep the retained value bounded.
 */
export function sanitizeTranscriptModel(value: unknown): string | undefined {
  return displayLabel(value, TRANSCRIPT_MODEL_MAX_LEN) || undefined;
}
