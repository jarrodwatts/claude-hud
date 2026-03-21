import fs from 'node:fs';
import path from 'node:path';
import type { HudConfig } from './config.js';

const DEBUG = process.env.DEBUG?.includes('claude-hud') || process.env.DEBUG === '*';

interface Preset {
  name: string;
  description: string;
  config: Partial<HudConfig>;
  createdAt: string;
}

function getPresetsPath(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(process.env.HOME || '', '.claude');
  return path.join(configDir, 'plugins', 'claude-hud', 'presets.json');
}

export function loadPresets(): Preset[] {
  try {
    return JSON.parse(fs.readFileSync(getPresetsPath(), 'utf-8'));
  } catch {
    return [];
  }
}

export function savePreset(name: string, description: string, config: Partial<HudConfig>): void {
  const presets = loadPresets();
  const existing = presets.findIndex(p => p.name === name);
  const preset: Preset = { name, description, config, createdAt: new Date().toISOString() };
  if (existing >= 0) presets[existing] = preset;
  else presets.push(preset);

  const dir = path.dirname(getPresetsPath());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getPresetsPath(), JSON.stringify(presets, null, 2));
  if (DEBUG) console.error(`[claude-hud:presets] saved preset "${name}"`);
}

export function getPreset(name: string): Preset | undefined {
  return loadPresets().find(p => p.name === name);
}

export function deletePreset(name: string): boolean {
  const presets = loadPresets();
  const idx = presets.findIndex(p => p.name === name);
  if (idx < 0) return false;
  presets.splice(idx, 1);
  fs.writeFileSync(getPresetsPath(), JSON.stringify(presets, null, 2));
  if (DEBUG) console.error(`[claude-hud:presets] deleted preset "${name}"`);
  return true;
}

export function exportPresetAsJson(preset: Preset): string {
  return JSON.stringify(preset, null, 2);
}
