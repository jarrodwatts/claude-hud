export const MAX_TERMINAL_WIDTH = 1000;

const columns = (value: unknown): number | null => {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) && parsed > 0
    ? Math.min(Math.floor(parsed), MAX_TERMINAL_WIDTH)
    : null;
};

/** Claude Code sets COLUMNS for the statusline; a TTY's own width is the fallback. */
export function getTerminalWidth(): number | null {
  return columns(process.env.COLUMNS) ?? columns(process.stdout?.columns) ?? columns(process.stderr?.columns);
}
