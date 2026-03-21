import { readCache, writeCache } from './cache.js';

const DEBUG = process.env.DEBUG?.includes('claude-hud') || process.env.DEBUG === '*';
const PERF_KEY = 'perf-history';
const TTL = 24 * 60 * 60 * 1000;
const BUDGET_MS = 250; // Leave 50ms margin from 300ms

interface PerfHistory {
  recentTimes: number[];  // last 10 execution times
  degradeMode: boolean;
}

export function shouldDegrade(cacheDir: string): boolean {
  const history = readCache<PerfHistory>(PERF_KEY, TTL, cacheDir);
  return history?.degradeMode ?? false;
}

export function recordExecutionTime(ms: number, cacheDir: string): void {
  const history = readCache<PerfHistory>(PERF_KEY, TTL, cacheDir) ?? {
    recentTimes: [],
    degradeMode: false,
  };

  history.recentTimes.push(ms);
  if (history.recentTimes.length > 10) history.recentTimes.shift();

  // Check if average of last 5 exceeds budget
  const recent5 = history.recentTimes.slice(-5);
  if (recent5.length >= 5) {
    const avg = recent5.reduce((a, b) => a + b, 0) / recent5.length;
    const wasDegrade = history.degradeMode;
    history.degradeMode = avg > BUDGET_MS;

    if (history.degradeMode && !wasDegrade && DEBUG) {
      console.error(`[claude-hud:perf] degrading — avg ${Math.round(avg)}ms > ${BUDGET_MS}ms budget`);
    }
    if (!history.degradeMode && wasDegrade && DEBUG) {
      console.error(`[claude-hud:perf] recovered — avg ${Math.round(avg)}ms`);
    }
  }

  writeCache(PERF_KEY, history, cacheDir);
}
