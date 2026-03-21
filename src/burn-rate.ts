import { readCache, writeCache } from './cache.js';
import type { BurnRate } from './types.js';

interface TokenSnapshot {
  tokens: number;
  timestamp: number;
}

const CACHE_KEY = 'burn-rate-snapshots';
const WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const MIN_DATA_MS = 60 * 1000;   // 60s minimum before showing
const SNAPSHOT_TTL = 10 * 60 * 1000; // 10 min cache TTL

export function recordTokenSnapshot(tokens: number, cacheDir: string, timestamp?: number): void {
  const now = timestamp ?? Date.now();
  const snapshots = readCache<TokenSnapshot[]>(CACHE_KEY, SNAPSHOT_TTL, cacheDir) ?? [];
  snapshots.push({ tokens, timestamp: now });
  const cutoff = now - WINDOW_MS;
  const trimmed = snapshots.filter(s => s.timestamp >= cutoff);
  writeCache(CACHE_KEY, trimmed, cacheDir);
}

export function calculateBurnRate(currentTokens: number, contextWindowSize: number, cacheDir: string): BurnRate | null {
  const snapshots = readCache<TokenSnapshot[]>(CACHE_KEY, SNAPSHOT_TTL, cacheDir);
  if (!snapshots || snapshots.length < 2) return null;

  const oldest = snapshots[0];
  const newest = snapshots[snapshots.length - 1];
  const elapsedMs = newest.timestamp - oldest.timestamp;

  if (elapsedMs < MIN_DATA_MS) return null;

  const tokenDelta = newest.tokens - oldest.tokens;
  if (tokenDelta <= 0) return null;

  const tokensPerMinute = Math.round((tokenDelta / elapsedMs) * 60000);
  const remaining = contextWindowSize - currentTokens;
  const avgPerCall = tokenDelta / (snapshots.length - 1);
  const estimatedCallsRemaining = avgPerCall > 0 ? Math.floor(remaining / avgPerCall) : 0;

  return { tokensPerMinute, estimatedCallsRemaining };
}
