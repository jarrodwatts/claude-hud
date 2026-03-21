import { readCache, writeCache } from './cache.js';
import type { SessionStats } from './types.js';

const CACHE_KEY = 'session-stats';
const HISTORY_KEY = 'context-history';
const SPARKLINE_KEY = 'context-sparkline';
const TTL = 24 * 60 * 60 * 1000;
const DROP_THRESHOLD = 20;
const SPARKLINE_MAX = 20;

interface ContextHistory {
  values: number[];
}

interface UpdateInput {
  contextPercent: number;
  toolCount: number;
  agentCount: number;
}

export function getSparkline(cacheDir: string): number[] {
  return readCache<number[]>(SPARKLINE_KEY, TTL, cacheDir) ?? [];
}

export function getSessionStats(cacheDir: string): SessionStats {
  const cached = readCache<SessionStats>(CACHE_KEY, TTL, cacheDir);
  return cached ?? {
    totalToolCalls: 0,
    totalAgentRuns: 0,
    peakContextPercent: 0,
    autocompactCount: 0,
  };
}

export function updateSessionStats(cacheDir: string, input: UpdateInput): void {
  const stats = getSessionStats(cacheDir);
  const history = readCache<ContextHistory>(HISTORY_KEY, TTL, cacheDir) ?? { values: [] };

  stats.totalToolCalls = input.toolCount;
  stats.totalAgentRuns = input.agentCount;
  if (input.contextPercent > stats.peakContextPercent) {
    stats.peakContextPercent = input.contextPercent;
  }

  history.values.push(input.contextPercent);
  if (history.values.length > 3) history.values.shift();

  if (history.values.length >= 3) {
    const [prev2, prev1, current] = history.values.slice(-3);
    const dropFromPrev2 = prev2 - prev1;
    const sustainedDrop = prev2 - current;
    if (dropFromPrev2 > DROP_THRESHOLD && sustainedDrop > DROP_THRESHOLD) {
      stats.autocompactCount++;
      history.values = [current];
    }
  }

  const sparkline = readCache<number[]>(SPARKLINE_KEY, TTL, cacheDir) ?? [];
  sparkline.push(input.contextPercent);
  if (sparkline.length > SPARKLINE_MAX) sparkline.shift();
  writeCache(SPARKLINE_KEY, sparkline, cacheDir);

  writeCache(CACHE_KEY, stats, cacheDir);
  writeCache(HISTORY_KEY, history, cacheDir);
}
