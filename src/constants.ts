/**
 * Autocompact buffer: Claude Code reserves tokens for the autocompact process.
 *
 * This value (~45k tokens) is an estimate based on community observations and
 * reverse-engineering. It is NOT officially documented by Anthropic and may
 * change between Claude Code versions.
 *
 * How it's used:
 * - Displayed percent shows raw usage (matches /context exactly)
 * - Warning colors and thresholds use (raw + buffer) to give advance notice
 * - "X% until auto-compact if enabled" = 100 - buffered percent
 *
 * If you notice the warnings are triggering too early or too late compared to
 * actual autocompact behavior, this value may need adjustment.
 */
export const AUTOCOMPACT_BUFFER = 45000;
