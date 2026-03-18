// Returns a progress bar width scaled to the current terminal width.
// Wide (>=100): 10, Medium (60-99): 6, Narrow (<60): 4. Defaults to 10.
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
