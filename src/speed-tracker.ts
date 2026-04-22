import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { StdinData } from './types.js';
import { getHudPluginDir } from './claude-config-dir.js';

const SPEED_WINDOW_MS = 2000;
// Status lines can re-render many times per second while tokens stream.
// Computing a rate from sub-500ms windows amplifies noise and produces
// spurious multi-thousand tok/s readings (see #481). Require at least
// half a second of elapsed time before reporting a speed.
const MIN_DELTA_MS = 500;

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

function getCachePath(homeDir: string): string {
  return path.join(getHudPluginDir(homeDir), '.speed-cache.json');
}

function readCache(homeDir: string): SpeedCache | null {
  try {
    const cachePath = getCachePath(homeDir);
    if (!fs.existsSync(cachePath)) return null;
    const content = fs.readFileSync(cachePath, 'utf8');
    const parsed = JSON.parse(content) as SpeedCache;
    if (typeof parsed.outputTokens !== 'number' || typeof parsed.timestamp !== 'number') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(homeDir: string, cache: SpeedCache): void {
  try {
    const cachePath = getCachePath(homeDir);
    const cacheDir = path.dirname(cachePath);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    fs.writeFileSync(cachePath, JSON.stringify(cache), 'utf8');
  } catch {
    // Ignore cache write failures
  }
}

export function getOutputSpeed(stdin: StdinData, overrides: Partial<SpeedTrackerDeps> = {}): number | null {
  const outputTokens = stdin.context_window?.current_usage?.output_tokens;
  if (typeof outputTokens !== 'number' || !Number.isFinite(outputTokens)) {
    return null;
  }

  const deps = { ...defaultDeps, ...overrides };
  const now = deps.now();
  const homeDir = deps.homeDir();
  const previous = readCache(homeDir);

  if (!previous) {
    writeCache(homeDir, { outputTokens, timestamp: now });
    return null;
  }

  if (outputTokens < previous.outputTokens) {
    writeCache(homeDir, { outputTokens, timestamp: now });
    return null;
  }

  let speed: number | null = null;
  const deltaTokens = outputTokens - previous.outputTokens;
  const deltaMs = now - previous.timestamp;

  if (deltaMs > SPEED_WINDOW_MS) {
    writeCache(homeDir, { outputTokens, timestamp: now });
    return null;
  }

  if (deltaTokens <= 0) {
    writeCache(homeDir, { outputTokens, timestamp: now });
    return null;
  }

  if (deltaMs < MIN_DELTA_MS) {
    return null;
  }

  speed = deltaTokens / (deltaMs / 1000);

  writeCache(homeDir, { outputTokens, timestamp: now });
  return speed;
}
