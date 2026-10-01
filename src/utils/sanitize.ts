// C0 and C1 controls, DEL, and the bidi marks, embeddings, overrides, and isolates.
const CONTROL_AND_BIDI = /[\u0000-\u001F\u007F-\u009F؜‎‏‪-‮⁦-⁩⁪-⁯]/g;

/** Untrusted text made safe to print: no escape sequences, controls, or bidi overrides. */
export function sanitizeDisplayText(input: string): string {
  return input
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '')
    .replace(/\x1B[@-Z\\-_]/g, '')
    .replace(CONTROL_AND_BIDI, '');
}
