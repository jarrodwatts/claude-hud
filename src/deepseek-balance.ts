import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { UsageData } from './types.js';
import { createDebug } from './debug.js';
import { getHudPluginDir } from './claude-config-dir.js';

const debug = createDebug('deepseek');
const CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;
const BALANCE_API_URL = 'https://api.deepseek.com/user/balance';

function isDeepSeekEndpoint(): boolean {
  const baseUrl = process.env.ANTHROPIC_BASE_URL?.trim();
  if (!baseUrl) return false;
  return /deepseek/i.test(baseUrl);
}

function getApiKey(): string | null {
  return process.env.ANTHROPIC_AUTH_TOKEN?.trim() || null;
}

function getCachePath(): string {
  return path.join(getHudPluginDir(os.homedir()), '.deepseek-cache.json');
}

interface CacheEntry {
  updatedAt: number;
  balanceLabel: string;
}

function readCache(): CacheEntry | null {
  try {
    const cachePath = getCachePath();
    if (!fs.existsSync(cachePath)) return null;
    const raw = fs.readFileSync(cachePath, 'utf8');
    const entry = JSON.parse(raw) as CacheEntry;
    if (Date.now() - entry.updatedAt > CACHE_TTL_MS) return null;
    return entry;
  } catch {
    return null;
  }
}

function writeCache(label: string): void {
  try {
    const entry: CacheEntry = { updatedAt: Date.now(), balanceLabel: label };
    const cachePath = getCachePath();
    const dir = path.dirname(cachePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(entry), 'utf8');
  } catch (err) {
    debug('Failed to write cache:', err);
  }
}

async function fetchBalanceLabel(apiKey: string): Promise<string | null> {
  try {
    const response = await fetch(BALANCE_API_URL, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      debug('API returned', response.status);
      return null;
    }

    const data = (await response.json()) as Record<string, unknown>;
    const balanceInfos = data?.balance_infos;
    if (!Array.isArray(balanceInfos) || balanceInfos.length === 0) {
      debug('No balance_infos in response');
      return null;
    }

    const info = balanceInfos[0] as Record<string, unknown>;
    const totalBalance = info?.total_balance;
    if (totalBalance == null) return null;

    const numericBalance = Number(totalBalance);
    if (!Number.isFinite(numericBalance)) return null;

    const currency = typeof info.currency === 'string' && info.currency
      ? info.currency
      : 'RMB';
    const symbol = currency === 'CNY' || currency === 'RMB' ? '¥' : `${currency} `;
    return `Balance ${symbol}${numericBalance.toFixed(2)}`;
  } catch (err) {
    debug('Fetch failed:', err);
    return null;
  }
}

export async function getDeepSeekUsage(): Promise<UsageData | null> {
  if (!isDeepSeekEndpoint()) {
    return null;
  }

  const cached = readCache();
  if (cached) {
    return {
      fiveHour: null,
      sevenDay: null,
      fiveHourResetAt: null,
      sevenDayResetAt: null,
      balanceLabel: cached.balanceLabel,
    };
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    debug('No API key found');
    return null;
  }

  const label = await fetchBalanceLabel(apiKey);
  if (!label) return null;

  writeCache(label);
  return {
    fiveHour: null,
    sevenDay: null,
    fiveHourResetAt: null,
    sevenDayResetAt: null,
    balanceLabel: label,
  };
}
