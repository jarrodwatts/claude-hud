export const UNKNOWN_TERMINAL_WIDTH = 40;
function parseEnvColumns() {
    const envColumns = Number.parseInt(process.env.COLUMNS ?? '', 10);
    return Number.isFinite(envColumns) && envColumns > 0 ? envColumns : null;
}
function parseStreamColumns(columns) {
    return typeof columns === 'number' && Number.isFinite(columns) && columns > 0
        ? Math.floor(columns)
        : null;
}
export function getTerminalWidth(options = {}) {
    const { preferEnv = false, fallback = null } = options;
    if (preferEnv) {
        return parseEnvColumns()
            ?? parseStreamColumns(process.stdout?.columns)
            ?? parseStreamColumns(process.stderr?.columns)
            ?? fallback;
    }
    return parseStreamColumns(process.stdout?.columns)
        ?? parseStreamColumns(process.stderr?.columns)
        ?? parseEnvColumns()
        ?? fallback;
}
// Returns a progress bar width scaled to the current terminal width.
// Wide (>=100): 10, Medium (60-99): 6, Narrow (<60): 4.
export function getAdaptiveBarWidth() {
    const cols = getTerminalWidth({ preferEnv: true });
    if (cols !== null) {
        if (cols >= 100)
            return 10;
        if (cols >= 60)
            return 6;
        return 4;
    }
    return 10;
}
//# sourceMappingURL=terminal.js.map