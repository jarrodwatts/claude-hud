import fs from 'node:fs';
import path from 'node:path';
import { readCache, writeCache } from './cache.js';

const DEBUG = process.env.DEBUG?.includes('claude-hud') || process.env.DEBUG === '*';

export interface CustomWidget {
  label: string;
  value: string;
  color?: string;  // named color
}

export function loadCustomWidgets(cacheDir: string): CustomWidget[] {
  const cached = readCache<CustomWidget[]>('custom-widgets', 5000, cacheDir);
  if (cached) return cached;

  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(process.env.HOME || '', '.claude');
  const widgetPath = path.join(configDir, 'plugins', 'claude-hud', 'widgets.json');

  try {
    if (!fs.existsSync(widgetPath)) return [];
    const data = JSON.parse(fs.readFileSync(widgetPath, 'utf-8'));
    if (!Array.isArray(data)) return [];

    const widgets: CustomWidget[] = data
      .filter((w: unknown) => typeof w === 'object' && w !== null && 'label' in w && 'value' in w)
      .slice(0, 5)  // max 5 widgets
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((w: any) => ({
        label: String(w.label).slice(0, 20),
        value: String(w.value).slice(0, 30),
        color: typeof w.color === 'string' ? w.color : undefined,
      }));

    writeCache('custom-widgets', widgets, cacheDir);
    return widgets;
  } catch {
    if (DEBUG) console.error('[claude-hud:widgets] error loading widgets');
    return [];
  }
}
