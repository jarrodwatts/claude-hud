export const UNKNOWN_TERMINAL_WIDTH = 40;
export function getTerminalWidth(columnsEnv = process.env.COLUMNS, stdoutCols = process.stdout?.columns) {
    const envCols = Number.parseInt(columnsEnv ?? '', 10);
    if (Number.isFinite(envCols) && envCols > 0) {
        return envCols;
    }
    if (typeof stdoutCols === 'number' && Number.isFinite(stdoutCols) && stdoutCols > 0) {
        return Math.floor(stdoutCols);
    }
    return undefined;
}
// Returns a progress bar width scaled to the current terminal width.
// Wide (>=100): 10, Medium (60-99): 6, Narrow (<60): 4.
export function getAdaptiveBarWidth() {
    const cols = getTerminalWidth();
    if (typeof cols === 'number' && Number.isFinite(cols) && cols > 0) {
        if (cols >= 100)
            return 10;
        if (cols >= 60)
            return 6;
        return 4;
    }
    return 10;
}
//# sourceMappingURL=terminal.js.map