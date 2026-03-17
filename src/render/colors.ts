import type { HudColorName, HudColorOverrides } from '../config.js';

export const RESET = '\x1b[0m';

const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const MAGENTA = '\x1b[35m';
const CYAN = '\x1b[36m';
const BRIGHT_BLUE = '\x1b[94m';
const BRIGHT_MAGENTA = '\x1b[95m';
const CLAUDE_ORANGE = '\x1b[38;5;208m';

const ANSI_BY_NAME: Record<HudColorName, string> = {
  red: RED,
  green: GREEN,
  yellow: YELLOW,
  magenta: MAGENTA,
  cyan: CYAN,
  brightBlue: BRIGHT_BLUE,
  brightMagenta: BRIGHT_MAGENTA,
};

function resolveAnsi(name: HudColorName | undefined, fallback: string): string {
  if (!name) {
    return fallback;
  }
  return ANSI_BY_NAME[name] ?? fallback;
}

function colorize(text: string, color: string): string {
  return `${color}${text}${RESET}`;
}

export function green(text: string): string {
  return colorize(text, GREEN);
}

export function yellow(text: string): string {
  return colorize(text, YELLOW);
}

export function red(text: string): string {
  return colorize(text, RED);
}

export function cyan(text: string): string {
  return colorize(text, CYAN);
}

export function magenta(text: string): string {
  return colorize(text, MAGENTA);
}

export function dim(text: string): string {
  return colorize(text, DIM);
}

export function claudeOrange(text: string): string {
  return colorize(text, CLAUDE_ORANGE);
}

export function warning(text: string, colors?: Partial<HudColorOverrides>): string {
  return colorize(text, resolveAnsi(colors?.warning, YELLOW));
}

export function critical(text: string, colors?: Partial<HudColorOverrides>): string {
  return colorize(text, resolveAnsi(colors?.critical, RED));
}

export function getContextColor(percent: number, colors?: Partial<HudColorOverrides>): string {
  if (percent >= 85) return resolveAnsi(colors?.critical, RED);
  if (percent >= 70) return resolveAnsi(colors?.warning, YELLOW);
  return resolveAnsi(colors?.context, GREEN);
}

export function getQuotaColor(percent: number, colors?: Partial<HudColorOverrides>): string {
  if (percent >= 90) return resolveAnsi(colors?.critical, RED);
  if (percent >= 75) return resolveAnsi(colors?.usageWarning, BRIGHT_MAGENTA);
  return resolveAnsi(colors?.usage, BRIGHT_BLUE);
}

export function quotaBar(percent: number, width: number = 10, colors?: Partial<HudColorOverrides>): string {
  const safeWidth = Number.isFinite(width) ? Math.max(0, Math.round(width)) : 0;
  const safePercent = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
  const filled = Math.round((safePercent / 100) * safeWidth);
  const empty = safeWidth - filled;
  const color = getQuotaColor(safePercent, colors);
  return `${color}${'█'.repeat(filled)}${DIM}${'░'.repeat(empty)}${RESET}`;
}

export function coloredBar(percent: number, width: number = 10, colors?: Partial<HudColorOverrides>): string {
  const safeWidth = Number.isFinite(width) ? Math.max(0, Math.round(width)) : 0;
  const safePercent = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
  const filled = Math.round((safePercent / 100) * safeWidth);
  const empty = safeWidth - filled;
  const color = getContextColor(safePercent, colors);
  return `${color}${'█'.repeat(filled)}${DIM}${'░'.repeat(empty)}${RESET}`;
}
