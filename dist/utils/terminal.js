// Modern status line integrations often invoke claude-hud through pipes, which
// means neither stdout nor stderr reports TTY columns. Defaulting to 40 causes
// avoidable wrapping in otherwise normal terminals, so keep a safer 80-column
// fallback that still avoids the old overly narrow wrapping.
export const UNKNOWN_TERMINAL_WIDTH = 80;
// Returns a progress bar width scaled to the current terminal width.
// Wide (>=100): 10, Medium (60-99): 6, Narrow (<60): 4.
export function getAdaptiveBarWidth() {
    const stdoutCols = process.stdout?.columns;
    const cols = (typeof stdoutCols === 'number' && Number.isFinite(stdoutCols) && stdoutCols > 0)
        ? Math.floor(stdoutCols)
        : Number.parseInt(process.env.COLUMNS ?? '', 10);
    if (Number.isFinite(cols) && cols > 0) {
        if (cols >= 100)
            return 10;
        if (cols >= 60)
            return 6;
        return 4;
    }
    return 10;
}
//# sourceMappingURL=terminal.js.map