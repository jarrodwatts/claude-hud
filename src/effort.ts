import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

type EffortLevel = 'low' | 'medium' | 'high';

const EFFORT_SYMBOLS: Record<EffortLevel, string> = {
  low: '○',
  medium: '◐',
  high: '●',
};

function readClaudeSettings(homeDir: string): Record<string, unknown> | null {
  const settingsPath = path.join(homeDir, '.claude', 'settings.json');
  try {
    if (!fs.existsSync(settingsPath)) return null;
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeEffortLevel(value: unknown): EffortLevel | null {
  if (typeof value === 'string' && (value === 'low' || value === 'medium' || value === 'high')) {
    return value;
  }
  return null;
}

/**
 * Returns the current Claude Code effort level as a display string,
 * e.g. "● high", "◐ medium", "○ low".
 *
 * Reads from CLAUDE_CODE_EFFORT_LEVEL env var first, then falls back
 * to ~/.claude/settings.json. Returns null when effort level is unset
 * or set to the default (medium).
 */
export function getEffortLevel(): string | null {
  const envValue = process.env.CLAUDE_CODE_EFFORT_LEVEL;
  if (envValue && envValue !== 'unset') {
    const level = normalizeEffortLevel(envValue);
    if (level) return `${EFFORT_SYMBOLS[level]} ${level}`;
  }

  const settings = readClaudeSettings(os.homedir());
  if (!settings) return null;

  const value = settings.effortLevel;
  if (value === 'unset' || value === undefined) return null;

  const level = normalizeEffortLevel(value);
  return level ? `${EFFORT_SYMBOLS[level]} ${level}` : null;
}

export function _readClaudeSettingsForTests(homeDir: string): Record<string, unknown> | null {
  return readClaudeSettings(homeDir);
}
