import { readCache, writeCache } from './cache.js';
import type { ToolEntry } from './types.js';

export interface ToolTokenStats {
  name: string;
  calls: number;
  avgTokensPerCall: number;
}

interface TokenTracker {
  snapshots: Array<{ tokens: number; toolCount: number; timestamp: number }>;
  toolCounts: Record<string, number>;
}

const CACHE_KEY = 'token-analytics';
const TTL = 24 * 60 * 60 * 1000;

export function updateTokenAnalytics(
  inputTokens: number,
  tools: ToolEntry[],
  cacheDir: string,
): void {
  const tracker = readCache<TokenTracker>(CACHE_KEY, TTL, cacheDir) ?? {
    snapshots: [],
    toolCounts: {},
  };

  // Count completed tools by name
  for (const tool of tools) {
    if (tool.status === 'completed' || tool.status === 'error') {
      tracker.toolCounts[tool.name] = (tracker.toolCounts[tool.name] || 0) + 1;
    }
  }

  // Record snapshot
  const totalTools = Object.values(tracker.toolCounts).reduce((a, b) => a + b, 0);
  tracker.snapshots.push({ tokens: inputTokens, toolCount: totalTools, timestamp: Date.now() });

  // Keep last 50 snapshots
  if (tracker.snapshots.length > 50) tracker.snapshots.shift();

  writeCache(CACHE_KEY, tracker, cacheDir);
}

export function getTopExpensiveTools(cacheDir: string, limit = 3): ToolTokenStats[] {
  const tracker = readCache<TokenTracker>(CACHE_KEY, TTL, cacheDir);
  if (!tracker || tracker.snapshots.length < 2) return [];

  const first = tracker.snapshots[0];
  const last = tracker.snapshots[tracker.snapshots.length - 1];
  const totalTokens = last.tokens - first.tokens;
  const totalCalls = last.toolCount - first.toolCount;

  if (totalCalls <= 0 || totalTokens <= 0) return [];

  const avgPerCall = totalTokens / totalCalls;

  // Return tools sorted by call frequency (proxy for cost contribution)
  return Object.entries(tracker.toolCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, calls]) => ({
      name,
      calls,
      avgTokensPerCall: Math.round(avgPerCall),
    }));
}
