import type { HudColorOverrides } from './config.js';

export interface ColorTheme {
  name: string;
  colors: HudColorOverrides;
}

export const THEMES: Record<string, ColorTheme> = {
  default: {
    name: 'Default',
    colors: {
      context: 'green',
      usage: 'brightBlue',
      warning: 'yellow',
      usageWarning: 'brightMagenta',
      critical: 'red',
    },
  },
  catppuccin: {
    name: 'Catppuccin Mocha',
    colors: {
      context: '#a6e3a1',      // green
      usage: '#89b4fa',        // blue
      warning: '#f9e2af',      // yellow
      usageWarning: '#cba6f7', // mauve
      critical: '#f38ba8',     // red
    },
  },
  dracula: {
    name: 'Dracula',
    colors: {
      context: '#50fa7b',      // green
      usage: '#8be9fd',        // cyan
      warning: '#f1fa8c',      // yellow
      usageWarning: '#bd93f9', // purple
      critical: '#ff5555',     // red
    },
  },
  nord: {
    name: 'Nord',
    colors: {
      context: '#a3be8c',      // green
      usage: '#81a1c1',        // blue
      warning: '#ebcb8b',      // yellow
      usageWarning: '#b48ead', // purple
      critical: '#bf616a',     // red
    },
  },
  catppuccin_latte: {
    name: 'Catppuccin Latte',
    colors: {
      context: '#40a02b',      // green
      usage: '#1e66f5',        // blue
      warning: '#df8e1d',      // yellow
      usageWarning: '#8839ef', // mauve
      critical: '#d20f39',     // red
    },
  },
  nord_light: {
    name: 'Nord Light',
    colors: {
      context: '#a3be8c',      // green (same as dark)
      usage: '#5e81ac',        // blue
      warning: '#ebcb8b',      // yellow (same as dark)
      usageWarning: '#b48ead', // purple (same as dark)
      critical: '#bf616a',     // red (same as dark)
    },
  },
};

export function getTheme(name: string): ColorTheme | undefined {
  return THEMES[name.toLowerCase()];
}

export function getThemeNames(): string[] {
  return Object.keys(THEMES);
}

export function detectTerminalTheme(): 'dark' | 'light' | null {
  // COLORFGBG format: "foreground;background" (e.g., "15;0" = white on black = dark)
  const colorfgbg = process.env.COLORFGBG;
  if (!colorfgbg) return null;

  const parts = colorfgbg.split(';');
  const bg = parseInt(parts[parts.length - 1], 10);
  if (isNaN(bg)) return null;

  // Low background color = dark theme, high = light theme
  return bg < 8 ? 'dark' : 'light';
}
