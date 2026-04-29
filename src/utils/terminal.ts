import * as fs from 'node:fs';
import * as tty from 'node:tty';

export const UNKNOWN_TERMINAL_WIDTH = null;

function parseEnvColumns(): number | null {
  const envColumns = Number.parseInt(process.env.COLUMNS ?? '', 10);
  return Number.isFinite(envColumns) && envColumns > 0 ? envColumns : null;
}

function parseStreamColumns(columns: unknown): number | null {
  return typeof columns === 'number' && Number.isFinite(columns) && columns > 0
    ? Math.floor(columns)
    : null;
}

function parseControllingTerminalColumns(): number | null {
  if (process.platform === 'win32' || process.env.CLAUDE_HUD_DISABLE_TTY_WIDTH === '1') {
    return null;
  }

  let fd: number | null = null;
  let stream: tty.WriteStream | null = null;
  try {
    fd = fs.openSync('/dev/tty', 'r+');
    stream = new tty.WriteStream(fd);
    fd = null;
    return parseStreamColumns(stream.columns);
  } catch {
    return null;
  } finally {
    if (stream) {
      stream.destroy();
    } else if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // Ignore close errors; width detection is best-effort.
      }
    }
  }
}

export function getTerminalWidth(options: { preferEnv?: boolean; fallback?: number | null } = {}): number | null {
  const { preferEnv = false, fallback = null } = options;

  if (preferEnv) {
    return parseEnvColumns()
      ?? parseStreamColumns(process.stdout?.columns)
      ?? parseStreamColumns(process.stderr?.columns)
      ?? parseControllingTerminalColumns()
      ?? fallback;
  }

  return parseStreamColumns(process.stdout?.columns)
    ?? parseStreamColumns(process.stderr?.columns)
    ?? parseEnvColumns()
    ?? parseControllingTerminalColumns()
    ?? fallback;
}

// Returns a progress bar width scaled to the current terminal width.
// Wide (>=100): 10, Medium (60-99): 6, Narrow (<60): 4.
export function getAdaptiveBarWidth(): number {
  const cols = getTerminalWidth({ preferEnv: true });

  if (cols !== null) {
    if (cols >= 100) return 10;
    if (cols >= 60) return 6;
    return 4;
  }
  return 10;
}
