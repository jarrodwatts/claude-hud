import type { ColorTheme } from '../config.js';

export const RESET = '\x1b[0m';

const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const MAGENTA = '\x1b[35m';
const CYAN = '\x1b[36m';
const BRIGHT_BLUE = '\x1b[94m';
const BRIGHT_MAGENTA = '\x1b[95m';

// Color theme accent colors (256-color mode)
const THEME_COLORS: Record<ColorTheme, string> = {
  gray: '\x1b[38;5;245m',
  orange: '\x1b[38;5;173m',
  blue: '\x1b[38;5;74m',
  teal: '\x1b[38;5;66m',
  green: '\x1b[38;5;71m',
  lavender: '\x1b[38;5;139m',
  rose: '\x1b[38;5;132m',
  gold: '\x1b[38;5;136m',
  slate: '\x1b[38;5;60m',
  cyan: '\x1b[38;5;37m',
};

// Current active theme (can be set at runtime)
let activeTheme: ColorTheme = 'blue';

export function setTheme(theme: ColorTheme): void {
  activeTheme = theme;
}

export function getTheme(): ColorTheme {
  return activeTheme;
}

export function accent(text: string): string {
  return `${THEME_COLORS[activeTheme]}${text}${RESET}`;
}

export function green(text: string): string {
  return `${GREEN}${text}${RESET}`;
}

export function yellow(text: string): string {
  return `${YELLOW}${text}${RESET}`;
}

export function red(text: string): string {
  return `${RED}${text}${RESET}`;
}

export function cyan(text: string): string {
  return `${CYAN}${text}${RESET}`;
}

export function magenta(text: string): string {
  return `${MAGENTA}${text}${RESET}`;
}

export function dim(text: string): string {
  return `${DIM}${text}${RESET}`;
}

export function getContextColor(percent: number): string {
  if (percent >= 85) return RED;
  if (percent >= 70) return YELLOW;
  return GREEN;
}

export function getQuotaColor(percent: number): string {
  if (percent >= 90) return RED;
  if (percent >= 75) return BRIGHT_MAGENTA;
  return BRIGHT_BLUE;
}

export function quotaBar(percent: number, width: number = 10): string {
  const safeWidth = Number.isFinite(width) ? Math.max(0, Math.round(width)) : 0;
  const safePercent = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
  const filled = Math.round((safePercent / 100) * safeWidth);
  const empty = safeWidth - filled;
  const color = getQuotaColor(safePercent);
  return `${color}${'█'.repeat(filled)}${DIM}${'░'.repeat(empty)}${RESET}`;
}

export function coloredBar(percent: number, width: number = 10): string {
  const safeWidth = Number.isFinite(width) ? Math.max(0, Math.round(width)) : 0;
  const safePercent = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
  const filled = Math.round((safePercent / 100) * safeWidth);
  const empty = safeWidth - filled;
  const color = getContextColor(safePercent);
  return `${color}${'█'.repeat(filled)}${DIM}${'░'.repeat(empty)}${RESET}`;
}
