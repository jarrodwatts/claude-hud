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
};

export function getTheme(name: string): ColorTheme | undefined {
  return THEMES[name.toLowerCase()];
}

export function getThemeNames(): string[] {
  return Object.keys(THEMES);
}
