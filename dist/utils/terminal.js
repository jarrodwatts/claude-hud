// 80 columns is the widely accepted minimum terminal width. When Claude Code
// runs claude-hud as a piped subprocess, stdout.columns is undefined and
// stderr/COLUMNS may also be unset. The previous value of 40 was too narrow:
// it caused normal lines to split at every │ separator, producing a stacked
// multi-line layout that did not match README examples or user expectations.
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