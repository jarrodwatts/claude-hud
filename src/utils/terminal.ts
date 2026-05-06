import * as fs from 'node:fs';
import * as tty from 'node:tty';

export const UNKNOWN_TERMINAL_WIDTH = null;

type TtyWriteStreamLike = Pick<tty.WriteStream, 'columns' | 'destroy'>;
type TtyWidthProbeDeps = {
  openSync: typeof fs.openSync;
  closeSync: typeof fs.closeSync;
  createWriteStream: (fd: number) => TtyWriteStreamLike;
};

const DEFAULT_TTY_WIDTH_PROBE_DEPS: TtyWidthProbeDeps = {
  openSync: fs.openSync,
  closeSync: fs.closeSync,
  createWriteStream: fd => new tty.WriteStream(fd),
};

let ttyWidthProbeDeps = DEFAULT_TTY_WIDTH_PROBE_DEPS;
let cachedControllingTerminalColumns: number | null | undefined;

function parseEnvColumns(): number | null {
  const envColumns = Number.parseInt(process.env.COLUMNS ?? '', 10);
  return Number.isFinite(envColumns) && envColumns > 0 ? envColumns : null;
}

function parseStreamColumns(columns: unknown): number | null {
  return typeof columns === 'number' && Number.isFinite(columns) && columns > 0
    ? Math.floor(columns)
    : null;
}

function readControllingTerminalColumns(): number | null {
  let fd: number | null = null;
  let stream: TtyWriteStreamLike | null = null;
  try {
    fd = ttyWidthProbeDeps.openSync('/dev/tty', 'r+');
    stream = ttyWidthProbeDeps.createWriteStream(fd);
    fd = null;
    return parseStreamColumns(stream.columns);
  } catch {
    return null;
  } finally {
    // Once tty.WriteStream is constructed, it owns the fd; destroy only the
    // stream to avoid double-closing under Node or Bun-compatible runtimes.
    if (stream) {
      stream.destroy();
    } else if (fd !== null) {
      try {
        ttyWidthProbeDeps.closeSync(fd);
      } catch {
        // Ignore close errors; width detection is best-effort.
      }
    }
  }
}

function parseControllingTerminalColumns(): number | null {
  if (process.platform === 'win32' || process.env.CLAUDE_HUD_DISABLE_TTY_WIDTH === '1') {
    return null;
  }

  if (cachedControllingTerminalColumns !== undefined) {
    return cachedControllingTerminalColumns;
  }

  cachedControllingTerminalColumns = readControllingTerminalColumns();
  return cachedControllingTerminalColumns;
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

export function _resetTerminalWidthCacheForTests(): void {
  cachedControllingTerminalColumns = undefined;
}

export function _setTtyWidthProbeDepsForTests(deps: Partial<TtyWidthProbeDeps> | null): void {
  ttyWidthProbeDeps = deps
    ? { ...DEFAULT_TTY_WIDTH_PROBE_DEPS, ...deps }
    : DEFAULT_TTY_WIDTH_PROBE_DEPS;
  _resetTerminalWidthCacheForTests();
}
