/**
 * Returns an adaptive progress bar width based on the current terminal width.
 *
 * | Terminal width | Bar width |
 * |---|---|
 * | ≥ 100 cols | 10 (default) |
 * | 60–99 cols | 6 |
 * | < 60 cols | 4 |
 *
 * Falls back to width 10 when terminal width cannot be determined
 * (e.g. non-TTY, piped output).
 */
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
