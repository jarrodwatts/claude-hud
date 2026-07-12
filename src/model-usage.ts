import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as https from 'node:https';
import type { UsageData } from './types.js';
import { getClaudeConfigDir, getHudPluginDir } from './claude-config-dir.js';
import { sanitizeDisplayText } from './utils/sanitize.js';
import { createDebug } from './debug.js';

const debug = createDebug('model-usage');

const CACHE_SUCCESS_TTL_MS = 5 * 60_000; // 5 minutes
const CACHE_FAILURE_TTL_MS = 60_000; // 60 seconds
const FETCH_TIMEOUT_MS = 4000;
const USAGE_API_HOST = 'api.anthropic.com';
const USAGE_API_PATH = '/api/oauth/usage';
const USER_AGENT = 'claude-code/2.1';
const OAUTH_BETA_HEADER = 'oauth-2025-04-20';
const MODEL_SCOPED_LABEL_MAX_LEN = 20;

type ModelScopedEntry = NonNullable<UsageData['modelScoped']>[number];

interface CachedEntry {
  label: string;
  percent: number;
  resetAt: string | null; // ISO string
}

interface CacheFileShape {
  fetchedAt: number;
  entries: CachedEntry[];
  failure?: boolean;
}

interface CredentialsFile {
  claudeAiOauth?: {
    accessToken?: string;
  };
}

interface UsageApiLimit {
  kind?: string;
  percent?: number;
  resets_at?: string;
  scope?: { model?: { display_name?: string | null } | null } | null;
  is_active?: boolean;
}

interface UsageApiResponse {
  limits?: UsageApiLimit[];
}

export type ModelUsageDeps = {
  homeDir: () => string;
  now: () => number;
};

const defaultDeps: ModelUsageDeps = {
  homeDir: () => os.homedir(),
  now: () => Date.now(),
};

/**
 * Custom providers (e.g. proxies swapped in via cc-switch) don't speak the
 * Anthropic OAuth usage API, so skip the fallback entirely rather than
 * firing requests at a host that won't understand them.
 */
function isUsingCustomApiEndpoint(env: NodeJS.ProcessEnv = process.env): boolean {
  const baseUrl = env.ANTHROPIC_BASE_URL?.trim() || env.ANTHROPIC_API_BASE_URL?.trim();
  if (!baseUrl) {
    return false;
  }
  try {
    return new URL(baseUrl).origin !== 'https://api.anthropic.com';
  } catch {
    return true;
  }
}

function getCachePath(homeDir: string): string {
  return path.join(getHudPluginDir(homeDir), '.model-usage-cache.json');
}

function readAccessToken(homeDir: string): string | null {
  try {
    const credPath = path.join(getClaudeConfigDir(homeDir), '.credentials.json');
    const raw = fs.readFileSync(credPath, 'utf8');
    const parsed = JSON.parse(raw) as CredentialsFile;
    const token = parsed?.claudeAiOauth?.accessToken;
    return typeof token === 'string' && token.length > 0 ? token : null;
  } catch (err) {
    debug('No usable OAuth credentials for model-scoped usage:', err);
    return null;
  }
}

function readCacheFile(homeDir: string): CacheFileShape | null {
  try {
    const raw = fs.readFileSync(getCachePath(homeDir), 'utf8');
    const parsed = JSON.parse(raw) as CacheFileShape;
    if (typeof parsed?.fetchedAt !== 'number' || !Array.isArray(parsed?.entries)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCacheFile(homeDir: string, cache: CacheFileShape): void {
  try {
    const cachePath = getCachePath(homeDir);
    const cacheDir = path.dirname(cachePath);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
    }
    // Atomic write (tmp + rename) so a concurrently-running HUD process never
    // reads a half-written cache file. Last writer wins on races — acceptable
    // for a 5-minute-TTL cache with no correctness requirement across processes.
    const tmpPath = `${cachePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    fs.writeFileSync(tmpPath, JSON.stringify(cache), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmpPath, cachePath);
  } catch (err) {
    debug('Failed to write model-usage cache:', err);
  }
}

function hydrateEntries(entries: CachedEntry[] | undefined | null): ModelScopedEntry[] {
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries
    .filter((e): e is CachedEntry => typeof e?.label === 'string' && typeof e?.percent === 'number')
    .map((e) => ({
      label: e.label,
      percent: e.percent,
      resetAt: e.resetAt ? new Date(e.resetAt) : null,
    }));
}

function dehydrateEntries(entries: ModelScopedEntry[]): CachedEntry[] {
  return entries.map((e) => ({
    label: e.label,
    percent: e.percent,
    resetAt: e.resetAt ? e.resetAt.toISOString() : null,
  }));
}

function parseIsoDate(value: string | undefined | null): Date | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseUsageApiLimits(limits: UsageApiLimit[] | undefined): ModelScopedEntry[] {
  if (!Array.isArray(limits)) {
    return [];
  }

  const result: ModelScopedEntry[] = [];
  for (const limit of limits) {
    if (limit?.kind !== 'weekly_scoped') {
      continue;
    }
    const displayName = limit?.scope?.model?.display_name;
    if (typeof displayName !== 'string') {
      continue;
    }
    const trimmed = displayName.trim();
    if (!trimmed) {
      continue;
    }
    const percent = limit?.percent;
    if (typeof percent !== 'number' || !Number.isFinite(percent)) {
      continue;
    }
    const sanitized = sanitizeDisplayText(trimmed).trim().slice(0, MODEL_SCOPED_LABEL_MAX_LEN);
    if (!sanitized) {
      continue;
    }

    result.push({
      label: sanitized,
      percent: Math.round(Math.min(100, Math.max(0, percent))),
      resetAt: parseIsoDate(limit?.resets_at),
    });
  }
  return result;
}

function fetchModelScopedUsage(accessToken: string): Promise<ModelScopedEntry[]> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      fn();
    };

    const req = https.request(
      {
        hostname: USAGE_API_HOST,
        path: USAGE_API_PATH,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'anthropic-beta': OAUTH_BETA_HEADER,
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
        },
        timeout: FETCH_TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            finish(() => reject(new Error(`usage API returned status ${status}`)));
            return;
          }
          try {
            const body = Buffer.concat(chunks).toString('utf8');
            const parsed = JSON.parse(body) as UsageApiResponse;
            finish(() => resolve(parseUsageApiLimits(parsed.limits)));
          } catch (err) {
            finish(() => reject(err instanceof Error ? err : new Error('Failed to parse usage API response')));
          }
        });
      },
    );

    req.on('timeout', () => {
      req.destroy();
      finish(() => reject(new Error('usage API request timed out')));
    });
    req.on('error', (err) => {
      finish(() => reject(err));
    });
    req.end();
  });
}

/**
 * Fetches per-model weekly usage buckets (e.g. "Fable") from the Anthropic
 * OAuth usage API, used as a fallback while Claude Code's statusline stdin
 * doesn't yet emit `rate_limits.model_scoped` (feature-gated as of 2.1.206).
 *
 * Results are cached to a file under the HUD plugin data dir (5 min TTL on
 * success, 60s on failure) because the HUD runs as a fresh process on every
 * statusline render (~300ms cadence) — without a file cache this would fire
 * a network request on every tick.
 *
 * Returns null when: a custom (non-Anthropic) API endpoint is configured,
 * OAuth credentials are missing/unreadable, or no weekly_scoped entries with
 * a model scope are present in the response and there's no usable stale
 * cache to fall back to.
 */
export async function getModelScopedUsage(
  overrides: Partial<ModelUsageDeps> = {},
): Promise<UsageData['modelScoped'] | null> {
  const deps: ModelUsageDeps = { ...defaultDeps, ...overrides };
  const homeDir = deps.homeDir();
  const now = deps.now();

  if (isUsingCustomApiEndpoint()) {
    debug('Skipping model-scoped usage: custom API endpoint configured');
    return null;
  }

  const cached = readCacheFile(homeDir);
  if (cached) {
    const ttl = cached.failure ? CACHE_FAILURE_TTL_MS : CACHE_SUCCESS_TTL_MS;
    if (now - cached.fetchedAt < ttl) {
      const entries = hydrateEntries(cached.entries);
      return entries.length > 0 ? entries : null;
    }
  }

  const accessToken = readAccessToken(homeDir);
  if (!accessToken) {
    return null;
  }

  try {
    const entries = await fetchModelScopedUsage(accessToken);
    writeCacheFile(homeDir, { fetchedAt: now, entries: dehydrateEntries(entries) });
    return entries.length > 0 ? entries : null;
  } catch (err) {
    debug('Failed to fetch model-scoped usage:', err);
    const staleEntries = cached ? hydrateEntries(cached.entries) : [];
    writeCacheFile(homeDir, { fetchedAt: now, entries: dehydrateEntries(staleEntries), failure: true });
    return staleEntries.length > 0 ? staleEntries : null;
  }
}
