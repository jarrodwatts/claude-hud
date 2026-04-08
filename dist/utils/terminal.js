import { execSync } from 'child_process';
export const UNKNOWN_TERMINAL_WIDTH = 120;
// Cache the detected TTY width so we only walk the process tree once.
let cachedTtyWidth = null;
let ttyWidthResolved = false;
/** @internal Reset the cached TTY width (for testing only). */
export function _resetTtyWidthCache() {
    cachedTtyWidth = null;
    ttyWidthResolved = false;
}
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
export function detectTtyWidth() {
    if (ttyWidthResolved)
        return cachedTtyWidth;
    try {
        // Walk up the process tree looking for a TTY
        let pid = process.ppid;
        for (let i = 0; i < 10; i++) {
            const tty = execSync(`ps -o tty=,ppid= -p ${pid} 2>/dev/null`, { timeout: 500 })
                .toString()
                .trim();
            if (!tty)
                break;
            const parts = tty.split(/\s+/);
            const ttyName = parts[0];
            const ppid = Number.parseInt(parts[1] ?? '', 10);
            if (ttyName && ttyName !== '??' && ttyName !== '?') {
                const dev = `/dev/${ttyName}`;
                const size = execSync(`stty size < ${dev} 2>/dev/null`, { timeout: 500 })
                    .toString()
                    .trim();
                const cols = Number.parseInt(size.split(/\s+/)[1] ?? '', 10);
                if (Number.isFinite(cols) && cols > 0) {
                    cachedTtyWidth = cols;
                    ttyWidthResolved = true;
                    return cols;
                }
            }
            if (!Number.isFinite(ppid) || ppid <= 1)
                break;
            pid = ppid;
        }
    }
    catch {
        // Detection failed — fall through to null
    }
    ttyWidthResolved = true;
    return null;
}
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