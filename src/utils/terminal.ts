export const UNKNOWN_TERMINAL_WIDTH = 40;

// Returns a progress bar width scaled to the current terminal width.
// Wide (>=100): 10, Medium (60-99): 6, Narrow (<60): 4.
export function getAdaptiveBarWidth(): number {
  const envCols = Number.parseInt(process.env.COLUMNS ?? '', 10);
  const stdoutCols = process.stdout?.columns;
  const cols = (Number.isFinite(envCols) && envCols > 0)
    ? envCols
    : (typeof stdoutCols === 'number' && Number.isFinite(stdoutCols) && stdoutCols > 0)
      ? Math.floor(stdoutCols)
      : Number.NaN;

  if (Number.isFinite(cols) && cols > 0) {
    if (cols >= 100) return 10;
    if (cols >= 60) return 6;
    return 4;
  }
  return 10;
}
