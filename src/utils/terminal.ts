// When no TTY width is detectable (stdout piped, stderr not a TTY, COLUMNS
// unset) we must not fall back to a small ceiling — every line then wraps to
// that value even on a 140-column terminal, defeating pair-merge and
// truncating multi-segment lines. A very large fallback matches the
// pre-0.0.12 behaviour of returning null (effectively "do not wrap") and
// lets the render layer trust its own logic.
export const UNKNOWN_TERMINAL_WIDTH = 10000;

// Returns a progress bar width scaled to the current terminal width.
// Wide (>=100): 10, Medium (60-99): 6, Narrow (<60): 4.
export function getAdaptiveBarWidth(): number {
  const stdoutCols = process.stdout?.columns;
  const cols = (typeof stdoutCols === 'number' && Number.isFinite(stdoutCols) && stdoutCols > 0)
    ? Math.floor(stdoutCols)
    : Number.parseInt(process.env.COLUMNS ?? '', 10);

  if (Number.isFinite(cols) && cols > 0) {
    if (cols >= 100) return 10;
    if (cols >= 60) return 6;
    return 4;
  }
  return 10;
}
