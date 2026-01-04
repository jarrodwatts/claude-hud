/**
 * Autocompact buffer: reserved space that /context includes in its calculation.
 * This is fixed at 45k tokens (22.5% of 200k) - must be added to match /context output.
 */
export const AUTOCOMPACT_BUFFER = 45000;
