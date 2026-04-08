export declare const UNKNOWN_TERMINAL_WIDTH = 120;
/** @internal Reset the cached TTY width (for testing only). */
export declare function _resetTtyWidthCache(): void;
/**
 * Detect the real terminal width by walking up the process tree to find a
 * parent that owns a TTY, then querying its size with `stty`.
 *
 * When Claude Code runs the statusline as a subprocess, both stdout and stderr
 * are piped so `process.stdout.columns` / `process.stderr.columns` are
 * undefined. However, an ancestor process (e.g. the shell that launched Claude
 * Code) still holds a TTY. We find it via `ps` and read its column count.
 *
 * Returns the detected width, or `null` if detection fails.
 */
export declare function detectTtyWidth(): number | null;
export declare function getAdaptiveBarWidth(): number;
//# sourceMappingURL=terminal.d.ts.map