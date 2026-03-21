import * as os from 'node:os';
import * as path from 'node:path';
import type { StdinData } from './types.js';
import { readCache, writeCache } from './cache.js';
import { getHudPluginDir } from './claude-config-dir.js';

const SPEED_WINDOW_MS = 2000;
const SPEED_CACHE_KEY = 'speed-tracker';

interface SpeedCache {
  outputTokens: number;
  timestamp: number;
}

export type SpeedTrackerDeps = {
  homeDir: () => string;
  now: () => number;
};

const defaultDeps: SpeedTrackerDeps = {
  homeDir: () => os.homedir(),
  now: () => Date.now(),
};

function getCacheDir(homeDir: string): string {
  return path.join(getHudPluginDir(homeDir), '.cache');
}

export function getOutputSpeed(stdin: StdinData, overrides: Partial<SpeedTrackerDeps> = {}): number | null {
  const outputTokens = stdin.context_window?.current_usage?.output_tokens;
  if (typeof outputTokens !== 'number' || !Number.isFinite(outputTokens)) {
    return null;
  }

  const deps = { ...defaultDeps, ...overrides };
  const now = deps.now();
  const cacheDir = getCacheDir(deps.homeDir());
  const previous = readCache<SpeedCache>(SPEED_CACHE_KEY, 5000, cacheDir);

  let speed: number | null = null;
  if (previous && outputTokens >= previous.outputTokens) {
    const deltaTokens = outputTokens - previous.outputTokens;
    const deltaMs = now - previous.timestamp;
    if (deltaTokens > 0 && deltaMs > 0 && deltaMs <= SPEED_WINDOW_MS) {
      speed = deltaTokens / (deltaMs / 1000);
    }
  }

  writeCache<SpeedCache>(SPEED_CACHE_KEY, { outputTokens, timestamp: now }, cacheDir);
  return speed;
}
