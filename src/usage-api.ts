import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';
import type { UsageData } from './types.js';

export type { UsageData } from './types.js';

// Debug logging (enabled via DEBUG=claude-hud or DEBUG=*)
const DEBUG = process.env.DEBUG?.includes('claude-hud') || process.env.DEBUG === '*';
function debug(msg: string, ...args: unknown[]): void {
  if (DEBUG) {
    console.error(`[claude-hud:usage] ${msg}`, ...args);
  }
}

interface CredentialsFile {
  claudeAiOauth?: {
    accessToken?: string;
    refreshToken?: string;
    subscriptionType?: string;
    rateLimitTier?: string;
    expiresAt?: number;  // Unix millisecond timestamp
    scopes?: string[];
  };
}

interface UsageApiResponse {
  five_hour?: {
    utilization?: number;
    resets_at?: string;
  };
  seven_day?: {
    utilization?: number;
    resets_at?: string;
  };
}

// File-based cache (HUD runs as new process each render, so in-memory cache won't persist)
const CACHE_TTL_MS = 60_000; // 60 seconds
const CACHE_FAILURE_TTL_MS = 15_000; // 15 seconds for failed requests

interface CacheFile {
  data: UsageData;
  timestamp: number;
}

function getCachePath(homeDir: string): string {
  return path.join(homeDir, '.claude', 'plugins', 'claude-hud', '.usage-cache.json');
}

function readCache(homeDir: string, now: number): UsageData | null {
  try {
    const cachePath = getCachePath(homeDir);
    if (!fs.existsSync(cachePath)) return null;

    const content = fs.readFileSync(cachePath, 'utf8');
    const cache: CacheFile = JSON.parse(content);

    // Check TTL - use shorter TTL for failure results
    const ttl = cache.data.apiUnavailable ? CACHE_FAILURE_TTL_MS : CACHE_TTL_MS;
    if (now - cache.timestamp >= ttl) return null;

    return cache.data;
  } catch {
    return null;
  }
}

function writeCache(homeDir: string, data: UsageData, timestamp: number): void {
  try {
    const cachePath = getCachePath(homeDir);
    const cacheDir = path.dirname(cachePath);

    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    const cache: CacheFile = { data, timestamp };
    fs.writeFileSync(cachePath, JSON.stringify(cache), 'utf8');
  } catch {
    // Ignore cache write failures
  }
}

// Dependency injection for testing
export type UsageApiDeps = {
  homeDir: () => string;
  fetchApi: (accessToken: string) => Promise<UsageApiResponse | null>;
  now: () => number;
};

const defaultDeps: UsageApiDeps = {
  homeDir: () => os.homedir(),
  fetchApi: fetchUsageApi,
  now: () => Date.now(),
};

/**
 * Get OAuth usage data from Anthropic API.
 * Returns null if user is an API user (no OAuth credentials) or credentials are expired.
 * Returns { apiUnavailable: true, ... } if API call fails (to show warning in HUD).
 *
 * Uses file-based cache since HUD runs as a new process each render (~300ms).
 * Cache TTL: 60s for success, 15s for failures.
 */
export async function getUsage(overrides: Partial<UsageApiDeps> = {}): Promise<UsageData | null> {
  const deps = { ...defaultDeps, ...overrides };
  const now = deps.now();
  const homeDir = deps.homeDir();

  // Check file-based cache first
  const cached = readCache(homeDir, now);
  if (cached) {
    return cached;
  }

  try {
    const credentials = readCredentials(homeDir, now);
    if (!credentials) {
      return null;
    }

    const { accessToken, subscriptionType } = credentials;

    // Determine plan name from subscriptionType
    const planName = getPlanName(subscriptionType);
    if (!planName) {
      // API user, no usage limits to show
      return null;
    }

    // Fetch usage from API
    const apiResponse = await deps.fetchApi(accessToken);
    if (!apiResponse) {
      // API call failed, cache the failure to prevent retry storms
      const failureResult: UsageData = {
        planName,
        fiveHour: null,
        sevenDay: null,
        fiveHourResetAt: null,
        sevenDayResetAt: null,
        apiUnavailable: true,
      };
      writeCache(homeDir, failureResult, now);
      return failureResult;
    }

    // Parse response - API returns 0-100 percentage directly
    // Clamp to 0-100 and handle NaN/Infinity
    const fiveHour = parseUtilization(apiResponse.five_hour?.utilization);
    const sevenDay = parseUtilization(apiResponse.seven_day?.utilization);

    const fiveHourResetAt = parseDate(apiResponse.five_hour?.resets_at);
    const sevenDayResetAt = parseDate(apiResponse.seven_day?.resets_at);

    const result: UsageData = {
      planName,
      fiveHour,
      sevenDay,
      fiveHourResetAt,
      sevenDayResetAt,
    };

    // Write to file cache
    writeCache(homeDir, result, now);

    return result;
  } catch (error) {
    debug('getUsage failed:', error);
    return null;
  }
}

function readCredentials(homeDir: string, now: number): { accessToken: string; subscriptionType: string } | null {
  const credentialsPath = path.join(homeDir, '.claude', '.credentials.json');

  if (!fs.existsSync(credentialsPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(credentialsPath, 'utf8');
    const data: CredentialsFile = JSON.parse(content);

    const accessToken = data.claudeAiOauth?.accessToken;
    const subscriptionType = data.claudeAiOauth?.subscriptionType ?? '';

    if (!accessToken) {
      return null;
    }

    // Check if token is expired (expiresAt is Unix ms timestamp)
    // Use != null to handle expiresAt=0 correctly (would be expired)
    const expiresAt = data.claudeAiOauth?.expiresAt;
    if (expiresAt != null && expiresAt <= now) {
      return null;
    }

    return { accessToken, subscriptionType };
  } catch (error) {
    debug('Failed to read credentials:', error);
    return null;
  }
}

function getPlanName(subscriptionType: string): string | null {
  const lower = subscriptionType.toLowerCase();
  if (lower.includes('max')) return 'Max';
  if (lower.includes('pro')) return 'Pro';
  if (lower.includes('team')) return 'Team';
  // API users don't have subscriptionType or have 'api'
  if (!subscriptionType || lower.includes('api')) return null;
  // Unknown subscription type - show it capitalized
  return subscriptionType.charAt(0).toUpperCase() + subscriptionType.slice(1);
}

/** Parse utilization value, clamping to 0-100 and handling NaN/Infinity */
function parseUtilization(value: number | undefined): number | null {
  if (value == null) return null;
  if (!Number.isFinite(value)) return null;  // Handles NaN and Infinity
  return Math.round(Math.max(0, Math.min(100, value)));
}

/** Parse ISO date string safely, returning null for invalid dates */
function parseDate(dateStr: string | undefined): Date | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  // Check for Invalid Date
  if (isNaN(date.getTime())) {
    debug('Invalid date string:', dateStr);
    return null;
  }
  return date;
}

function fetchUsageApi(accessToken: string): Promise<UsageApiResponse | null> {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.anthropic.com',
      path: '/api/oauth/usage',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': 'claude-hud/1.0',
      },
      timeout: 5000,
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk: Buffer) => {
        data += chunk.toString();
      });

      res.on('end', () => {
        if (res.statusCode !== 200) {
          debug('API returned non-200 status:', res.statusCode);
          resolve(null);
          return;
        }

        try {
          const parsed: UsageApiResponse = JSON.parse(data);
          resolve(parsed);
        } catch (error) {
          debug('Failed to parse API response:', error);
          resolve(null);
        }
      });
    });

    req.on('error', (error) => {
      debug('API request error:', error);
      resolve(null);
    });
    req.on('timeout', () => {
      debug('API request timeout');
      req.destroy();
      resolve(null);
    });

    req.end();
  });
}

// Export for testing
export function clearCache(homeDir?: string): void {
  if (homeDir) {
    try {
      const cachePath = getCachePath(homeDir);
      if (fs.existsSync(cachePath)) {
        fs.unlinkSync(cachePath);
      }
    } catch {
      // Ignore
    }
  }
}
