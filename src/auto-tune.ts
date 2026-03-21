import type { HudConfig } from './config.js';

const DEBUG = process.env.DEBUG?.includes('claude-hud') || process.env.DEBUG === '*';

export function autoTuneConfig(config: HudConfig, terminalWidth: number | null, _cacheDir: string): HudConfig {
  if (!config.display.autoTune) return config;

  const tuned = { ...config, display: { ...config.display } };

  // Auto pathLevels based on terminal width
  if (terminalWidth !== null) {
    if (terminalWidth >= 120 && config.pathLevels === 1) {
      tuned.pathLevels = 2;
    } else if (terminalWidth < 60 && config.pathLevels > 1) {
      tuned.pathLevels = 1;
    }
  }

  // Auto barStyle: use modern for wide terminals
  if (terminalWidth !== null && terminalWidth >= 100 && config.display.barStyle === 'classic') {
    tuned.display.barStyle = 'modern';
  }

  if (DEBUG) console.error('[claude-hud:auto-tune] applied tuning');

  return tuned;
}
