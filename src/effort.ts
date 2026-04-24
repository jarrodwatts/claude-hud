import { execFileSync } from 'node:child_process';

export interface EffortInfo {
  level: string;
  symbol: string;
}

const KNOWN_SYMBOLS: Record<string, string> = {
  low: '○',
  medium: '◔',
  high: '◑',
  xhigh: '◕',
  max: '●',
};

/**
 * Shape of the effort field in Claude Code stdin JSON.
 *
 * Historically absent; Claude Code 2.1.115+ sends an object with a string
 * `level` field (verified capture: `{ "level": "max" }`). The index signature
 * keeps the type permissive so future additions (e.g., a budget field) do not
 * require another breaking change here.
 */
export interface StdinEffort {
  level?: string | null;
  [key: string]: unknown;
}

export type StdinEffortInput = string | StdinEffort | null | undefined;

/**
 * Resolve the current session's effort level.
 *
 * Resolution order (matches `extractEffortString` below):
 * 1. stdin.effort as non-empty string — original PR #471 future-proofed path.
 * 2. stdin.effort as object with string `level` — Claude Code 2.1.115+ schema
 *    (e.g., `{ "level": "max" }`).
 * 3. Parent process CLI args — `--effort` flag captured from ppid.
 * 4. null.
 *
 * Non-matching inputs (numbers, booleans, arrays, objects without a string
 * `level`) fall through to step 3 rather than crashing.
 */
export function resolveEffortLevel(
  stdinEffort?: StdinEffortInput
): EffortInfo | null {
  const fromStdin = extractEffortString(stdinEffort);
  if (fromStdin) {
    return formatEffort(fromStdin);
  }

  const cliEffort = readParentProcessEffort();
  if (cliEffort) {
    return formatEffort(cliEffort);
  }

  return null;
}

function extractEffortString(value: unknown): string | null {
  if (typeof value === 'string') {
    return value.length > 0 ? value : null;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const level = (value as { level?: unknown }).level;
    if (typeof level === 'string' && level.length > 0) {
      return level;
    }
  }
  return null;
}

function formatEffort(level: string): EffortInfo {
  const normalized = level.toLowerCase().trim();
  const symbol = KNOWN_SYMBOLS[normalized] ?? '';
  return { level: normalized, symbol };
}

function readParentProcessEffort(): string | null {
  if (process.platform === 'win32') {
    return null;
  }

  try {
    const ppid = process.ppid;
    if (!ppid || ppid <= 1) {
      return null;
    }

    const output = execFileSync('ps', ['-o', 'args=', '-p', String(ppid)], {
      encoding: 'utf8',
      timeout: 500,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    const match = output.match(/--effort[= ]+(\w+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}
