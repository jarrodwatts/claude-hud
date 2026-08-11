/**
 * Autocompact buffer percentage.
 *
 * NOTE: This value is applied as a percentage of Claude Code's reported
 * context window size. The `33k/200k` example is just the 200k-window case.
 * It is empirically derived from current Claude Code `/context` output, is
 * not officially documented by Anthropic, and may need adjustment if users
 * report mismatches in future Claude Code versions.
 */
export const AUTOCOMPACT_BUFFER_PERCENT = 0.165;

/**
 * Prompt cache TTL tiers, in seconds. The API offers exactly these two (5
 * minutes and 1 hour) and every cache write records which one it used, so the
 * TTL is read from the transcript rather than configured.
 */
export const PROMPT_CACHE_TTL_5M_SECONDS = 300;
export const PROMPT_CACHE_TTL_1H_SECONDS = 3600;

/**
 * Shortest tier, used until a cache write has been seen. Conservative on
 * purpose: it reports expiry early rather than promising time that is gone.
 */
export const PROMPT_CACHE_DEFAULT_TTL_SECONDS = PROMPT_CACHE_TTL_5M_SECONDS;

/**
 * True only for a TTL that a real cache write could have produced. Applied to
 * values read back from the transcript cache file, where anything else means
 * the snapshot is corrupt and the detected TTL should be dropped.
 */
export function isDetectedPromptCacheTtl(value: unknown): value is number {
  return value === PROMPT_CACHE_TTL_5M_SECONDS || value === PROMPT_CACHE_TTL_1H_SECONDS;
}
