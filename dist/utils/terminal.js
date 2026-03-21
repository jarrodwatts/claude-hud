// Returns a progress bar width scaled to the current terminal width.
// Wide (>=100): 10, Medium (60-99): 6, Narrow (<60): 4. Defaults to 10.
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
// Returns the current terminal width in columns, or null if unknown.
// Checks stdout, then stderr (for piped subprocess mode), then COLUMNS env var.
export function getTerminalWidth() {
    const stdoutColumns = process.stdout?.columns;
    if (typeof stdoutColumns === 'number' && Number.isFinite(stdoutColumns) && stdoutColumns > 0) {
        return Math.floor(stdoutColumns);
    }
    // When running as a statusline subprocess, stdout is piped but stderr is
    // still connected to the real terminal — use it to get the actual width.
    const stderrColumns = process.stderr?.columns;
    if (typeof stderrColumns === 'number' && Number.isFinite(stderrColumns) && stderrColumns > 0) {
        return Math.floor(stderrColumns);
    }
    const envColumns = Number.parseInt(process.env.COLUMNS ?? '', 10);
    if (Number.isFinite(envColumns) && envColumns > 0) {
        return envColumns;
    }
    return null;
}
export function isNarrowTerminal(width) {
    return width !== null && width < 80;
}
export function isVeryNarrowTerminal(width) {
    return width !== null && width < 60;
}
//# sourceMappingURL=terminal.js.map