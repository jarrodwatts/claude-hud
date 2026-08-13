import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDebug } from './debug.js';
import { getHudPluginDir } from './claude-config-dir.js';
import type { HudConfig } from './config.js';

const debug = createDebug('provider-quota');

/** How long a cached response is considered fresh (60 seconds). */
const CACHE_TTL_MS = 60_000;

/** HTTP timeout for quota API calls (5 seconds). */
const FETCH_TIMEOUT_MS = 5_000;

export interface ProviderQuotaEntry {
  provider: string;
  intervalRemainingPercent: number | null;
  weeklyRemainingPercent: number | null;
  error: string | null;
}

export interface ProviderQuotaData {
  entries: ProviderQuotaEntry[];
}

interface CachedQuota {
  fetchedAt: number;
  entries: ProviderQuotaEntry[];
}

function quotaCachePath(homeDir: string): string {
  return path.join(getHudPluginDir(homeDir), 'provider-quota-cache.json');
}

function readCache(homeDir: string, now: number): ProviderQuotaEntry[] | null {
  try {
    const cachePath = quotaCachePath(homeDir);
    if (!fs.existsSync(cachePath)) return null;
    const raw = fs.readFileSync(cachePath, 'utf-8');
    const cached: CachedQuota = JSON.parse(raw);
    if (!cached.fetchedAt || now - cached.fetchedAt > CACHE_TTL_MS) return null;
    if (!Array.isArray(cached.entries)) return null;
    return cached.entries;
  } catch {
    return null;
  }
}

function writeCache(homeDir: string, entries: ProviderQuotaEntry[], now: number): void {
  try {
    const cachePath = quotaCachePath(homeDir);
    const dir = path.dirname(cachePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${cachePath}.${process.pid}.${now}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify({ fetchedAt: now, entries }, null, 2), 'utf-8');
    fs.renameSync(tmpPath, cachePath);
  } catch (err) {
    debug('Failed to write quota cache:', err instanceof Error ? err.message : err);
  }
}

async function fetchWithTimeout(url: string, headers: Record<string, string>): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchMinimaxQuota(apiKey: string): Promise<ProviderQuotaEntry> {
  const entry: ProviderQuotaEntry = {
    provider: 'MiniMax',
    intervalRemainingPercent: null,
    weeklyRemainingPercent: null,
    error: null,
  };
  try {
    const data = await fetchWithTimeout(
      'https://api.minimax.io/v1/api/openplatform/coding_plan/remains',
      { Authorization: `Bearer ${apiKey}` },
    ) as any;
    
    if (data?.base_resp?.status_code === 0 && Array.isArray(data.model_remains) && data.model_remains.length > 0) {
      // Find 'MiniMax-M2.7' or default to the first entry
      let modelData = data.model_remains.find((m: any) => m.model_name === 'MiniMax-M2.7');
      if (!modelData) {
        modelData = data.model_remains[0];
      }
      
      const pctInterval = modelData.current_interval_remaining_percent;
      if (typeof pctInterval === 'number') {
        entry.intervalRemainingPercent = Math.max(0, Math.min(100, pctInterval));
      }
      
      const pctWeekly = modelData.current_weekly_remaining_percent;
      if (typeof pctWeekly === 'number') {
        entry.weeklyRemainingPercent = Math.max(0, Math.min(100, pctWeekly));
      }
    } else if (data?.base_resp?.status_msg) {
      throw new Error(data.base_resp.status_msg);
    } else {
      throw new Error('Invalid response structure');
    }
  } catch (err) {
    entry.error = err instanceof Error ? err.message : 'Unknown error';
    debug('MiniMax quota fetch failed:', entry.error);
  }
  return entry;
}

async function fetchZhipuQuota(apiKey: string): Promise<ProviderQuotaEntry> {
  const entry: ProviderQuotaEntry = {
    provider: 'Zhipu',
    intervalRemainingPercent: null,
    weeklyRemainingPercent: null,
    error: null,
  };

  const endpoints = [
    'https://bigmodel.cn/api/monitor/usage/quota/limit',
    'https://open.bigmodel.cn/api/monitor/usage/quota/limit',
    'https://api.z.ai/api/monitor/usage/quota/limit',
  ];

  for (const url of endpoints) {
    try {
      const data = await fetchWithTimeout(
        url,
        { 
          'Authorization': apiKey, // Zhipu monitor endpoint uses raw key without Bearer prefix
          'Content-Type': 'application/json'
        },
      ) as Record<string, unknown>;
      // Parse limits array for token quota
      const limits = Array.isArray(data?.limits) ? data.limits : (Array.isArray((data as any)?.data?.limits) ? (data as any).data.limits : null);
      if (limits) {
        for (const limit of limits) {
          if (!limit || typeof limit !== 'object') continue;
          const rec = limit as Record<string, unknown>;
          const type = rec.type ?? rec.limit_type;
          if (type === 'TOKENS_LIMIT' || type === 'tokens') {
            const pctUsed = rec.percentage;
            if (typeof pctUsed === 'number' && Number.isFinite(pctUsed)) {
              // Zhipu reports 'used' percentage for TOKENS_LIMIT, convert to remaining
              const pctRemain = Math.max(0, Math.min(100, 100 - pctUsed));
              if (entry.intervalRemainingPercent === null) {
                entry.intervalRemainingPercent = Math.round(pctRemain);
              } else if (entry.weeklyRemainingPercent === null) {
                entry.weeklyRemainingPercent = Math.round(pctRemain);
              }
            }
          }
        }
      }
      // If we got a successful response, don't try fallback
      entry.error = null;
      break;
    } catch (err) {
      entry.error = err instanceof Error ? err.message : 'Unknown error';
      debug('Zhipu quota fetch failed for %s:', url, entry.error);
    }
  }

  return entry;
}

export async function fetchProviderQuotas(config: HudConfig): Promise<ProviderQuotaData | null> {
  const providerQuota = (config as any).providerQuota;
  if (!providerQuota || typeof providerQuota !== 'object') {
    return null;
  }

  const minimaxKey = typeof providerQuota.minimax?.apiKey === 'string'
    ? providerQuota.minimax.apiKey.trim()
    : '';
  const zhipuKey = typeof providerQuota.zhipu?.apiKey === 'string'
    ? providerQuota.zhipu.apiKey.trim()
    : '';

  if (!minimaxKey && !zhipuKey) {
    return null;
  }

  const homeDir = os.homedir();
  const now = Date.now();

  // Return cached data if fresh
  const cached = readCache(homeDir, now);
  if (cached) {
    return { entries: cached };
  }

  // Fetch in parallel
  const promises: Promise<ProviderQuotaEntry>[] = [];
  if (minimaxKey) promises.push(fetchMinimaxQuota(minimaxKey));
  if (zhipuKey) promises.push(fetchZhipuQuota(zhipuKey));

  const entries = await Promise.all(promises);
  writeCache(homeDir, entries, now);
  return { entries };
}
