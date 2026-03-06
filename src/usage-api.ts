import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as net from 'net';
import * as tls from 'tls';
import * as https from 'https';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import type { UsageData } from './types.js';
import { createDebug } from './debug.js';
import { getClaudeConfigDir, getHudPluginDir } from './claude-config-dir.js';

export type { UsageData } from './types.js';

const debug = createDebug('usage');
const LEGACY_KEYCHAIN_SERVICE_NAME = 'Claude Code-credentials';

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

interface UsageApiResult {
  data: UsageApiResponse | null;
  error?: string;
}

// File-based cache (HUD runs as new process each render, so in-memory cache won't persist)
const CACHE_TTL_MS = 60_000; // 60 seconds
const CACHE_FAILURE_TTL_MS = 15_000; // 15 seconds for failed requests
const CACHE_LOCK_STALE_MS = 30_000;
const CACHE_LOCK_WAIT_MS = 2_000;
const CACHE_LOCK_POLL_MS = 50;
const KEYCHAIN_TIMEOUT_MS = 3000;
const KEYCHAIN_BACKOFF_MS = 60_000; // Backoff on keychain failures to avoid re-prompting
const USAGE_API_TIMEOUT_MS_DEFAULT = 15_000;
export const USAGE_API_USER_AGENT = 'claude-code/2.1';

/**
 * Check if user is using a custom API endpoint instead of the default Anthropic API.
 * When using custom providers (e.g., via cc-switch), the OAuth usage API is not applicable.
 */
function isUsingCustomApiEndpoint(env: NodeJS.ProcessEnv = process.env): boolean {
  const baseUrl = env.ANTHROPIC_BASE_URL?.trim() || env.ANTHROPIC_API_BASE_URL?.trim();

  // No custom endpoint configured - using default Anthropic API
  if (!baseUrl) {
    return false;
  }

  try {
    return new URL(baseUrl).origin !== 'https://api.anthropic.com';
  } catch {
    return true;
  }
}

interface CacheFile {
  data: UsageData;
  timestamp: number;
}

interface CacheState {
  data: UsageData;
  timestamp: number;
  isFresh: boolean;
}

type CacheLockStatus = 'acquired' | 'busy' | 'unsupported';

function getCachePath(homeDir: string): string {
  return path.join(getHudPluginDir(homeDir), '.usage-cache.json');
}

function getCacheLockPath(homeDir: string): string {
  return path.join(getHudPluginDir(homeDir), '.usage-cache.lock');
}

function hydrateCacheData(data: UsageData): UsageData {
  // JSON.stringify converts Date to ISO string, so we need to reconvert on read.
  // new Date() handles both Date objects and ISO strings safely.
  if (data.fiveHourResetAt) {
    data.fiveHourResetAt = new Date(data.fiveHourResetAt);
  }
  if (data.sevenDayResetAt) {
    data.sevenDayResetAt = new Date(data.sevenDayResetAt);
  }
  return data;
}

type CacheTtls = { cacheTtlMs: number; failureCacheTtlMs: number };

function readCacheState(homeDir: string, now: number, ttls: CacheTtls): CacheState | null {
  try {
    const cachePath = getCachePath(homeDir);
    if (!fs.existsSync(cachePath)) return null;

    const content = fs.readFileSync(cachePath, 'utf8');
    const cache: CacheFile = JSON.parse(content);

    // Check TTL - use shorter TTL for failure results
    const ttl = cache.data.apiUnavailable ? ttls.failureCacheTtlMs : ttls.cacheTtlMs;
    return {
      data: hydrateCacheData(cache.data),
      timestamp: cache.timestamp,
      isFresh: now - cache.timestamp < ttl,
    };
  } catch {
    return null;
  }
}

function readCache(homeDir: string, now: number, ttls: CacheTtls): UsageData | null {
  const cache = readCacheState(homeDir, now, ttls);
  return cache?.isFresh ? cache.data : null;
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

function readLockTimestamp(lockPath: string): number | null {
  try {
    if (!fs.existsSync(lockPath)) return null;
    const raw = fs.readFileSync(lockPath, 'utf8').trim();
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function tryAcquireCacheLock(homeDir: string): CacheLockStatus {
  const lockPath = getCacheLockPath(homeDir);
  const cacheDir = path.dirname(lockPath);

  try {
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    const fd = fs.openSync(lockPath, 'wx');
    try {
      fs.writeFileSync(fd, String(Date.now()), 'utf8');
    } finally {
      fs.closeSync(fd);
    }
    return 'acquired';
  } catch (error) {
    const maybeError = error as NodeJS.ErrnoException;
    if (maybeError.code !== 'EEXIST') {
      debug('Usage cache lock unavailable, continuing without coordination:', maybeError.message);
      return 'unsupported';
    }
  }

  const lockTimestamp = readLockTimestamp(lockPath);
  if (lockTimestamp != null && Date.now() - lockTimestamp > CACHE_LOCK_STALE_MS) {
    try {
      fs.unlinkSync(lockPath);
    } catch {
      return 'busy';
    }
    return tryAcquireCacheLock(homeDir);
  }

  return 'busy';
}

function releaseCacheLock(homeDir: string): void {
  try {
    const lockPath = getCacheLockPath(homeDir);
    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
    }
  } catch {
    // Ignore lock cleanup failures
  }
}

async function waitForFreshCache(
  homeDir: string,
  now: () => number,
  ttls: CacheTtls,
  timeoutMs: number = CACHE_LOCK_WAIT_MS
): Promise<UsageData | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, CACHE_LOCK_POLL_MS));
    const cached = readCache(homeDir, now(), ttls);
    if (cached) {
      return cached;
    }

    if (!fs.existsSync(getCacheLockPath(homeDir))) {
      break;
    }
  }

  return readCache(homeDir, now(), ttls);
}

// Dependency injection for testing
export type UsageApiDeps = {
  homeDir: () => string;
  fetchApi: (accessToken: string) => Promise<UsageApiResult>;
  now: () => number;
  readKeychain: (now: number, homeDir: string) => { accessToken: string; subscriptionType: string } | null;
  ttls: CacheTtls;
};

const defaultDeps: UsageApiDeps = {
  homeDir: () => os.homedir(),
  fetchApi: fetchUsageApi,
  now: () => Date.now(),
  readKeychain: readKeychainCredentials,
  ttls: { cacheTtlMs: CACHE_TTL_MS, failureCacheTtlMs: CACHE_FAILURE_TTL_MS },
};

/**
 * Get OAuth usage data from Anthropic API.
 * Returns null if user is an API user (no OAuth credentials) or credentials are expired.
 * Returns { apiUnavailable: true, ... } if API call fails (to show warning in HUD).
 *
 * Uses file-based cache since HUD runs as a new process each render (~300ms).
 * Cache TTL is configurable via usage.cacheTtlSeconds / usage.failureCacheTtlSeconds in config.json
 * (defaults: 60s for success, 15s for failures).
 */
export async function getUsage(overrides: Partial<UsageApiDeps> = {}): Promise<UsageData | null> {
  const deps = { ...defaultDeps, ...overrides };
  const now = deps.now();
  const homeDir = deps.homeDir();

  // Skip usage API if user is using a custom provider
  if (isUsingCustomApiEndpoint()) {
    debug('Skipping usage API: custom API endpoint configured');
    return null;
  }
  // Check file-based cache first
  const cacheState = readCacheState(homeDir, now, deps.ttls);
  if (cacheState?.isFresh) {
    return cacheState.data;
  }

  let holdsCacheLock = false;
  const lockStatus = tryAcquireCacheLock(homeDir);
  if (lockStatus === 'busy') {
    if (cacheState) {
      return cacheState.data;
    }
    return await waitForFreshCache(homeDir, deps.now, deps.ttls);
  }
  holdsCacheLock = lockStatus === 'acquired';

  try {
    const refreshedCache = readCache(homeDir, deps.now(), deps.ttls);
    if (refreshedCache) {
      return refreshedCache;
    }

    const credentials = readCredentials(homeDir, now, deps.readKeychain);
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
    const apiResult = await deps.fetchApi(accessToken);
    if (!apiResult.data) {
      // API call failed, cache the failure to prevent retry storms
      const failureResult: UsageData = {
        planName,
        fiveHour: null,
        sevenDay: null,
        fiveHourResetAt: null,
        sevenDayResetAt: null,
        apiUnavailable: true,
        apiError: apiResult.error,
      };
      writeCache(homeDir, failureResult, now);
      return failureResult;
    }

    // Parse response - API returns 0-100 percentage directly
    // Clamp to 0-100 and handle NaN/Infinity
    const fiveHour = parseUtilization(apiResult.data.five_hour?.utilization);
    const sevenDay = parseUtilization(apiResult.data.seven_day?.utilization);

    const fiveHourResetAt = parseDate(apiResult.data.five_hour?.resets_at);
    const sevenDayResetAt = parseDate(apiResult.data.seven_day?.resets_at);

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
  } finally {
    if (holdsCacheLock) {
      releaseCacheLock(homeDir);
    }
  }
}

/**
 * Get path for keychain failure backoff cache.
 * Separate from usage cache to track keychain-specific failures.
 */
function getKeychainBackoffPath(homeDir: string): string {
  return path.join(getHudPluginDir(homeDir), '.keychain-backoff');
}

/**
 * Check if we're in keychain backoff period (recent failure/timeout).
 * Prevents re-prompting user on every render cycle.
 */
function isKeychainBackoff(homeDir: string, now: number): boolean {
  try {
    const backoffPath = getKeychainBackoffPath(homeDir);
    if (!fs.existsSync(backoffPath)) return false;
    const timestamp = parseInt(fs.readFileSync(backoffPath, 'utf8'), 10);
    return now - timestamp < KEYCHAIN_BACKOFF_MS;
  } catch {
    return false;
  }
}

/**
 * Record keychain failure for backoff.
 */
function recordKeychainFailure(homeDir: string, now: number): void {
  try {
    const backoffPath = getKeychainBackoffPath(homeDir);
    const dir = path.dirname(backoffPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(backoffPath, String(now), 'utf8');
  } catch {
    // Ignore write failures
  }
}

/**
 * Determine the macOS Keychain service name for Claude Code credentials.
 * Claude Code uses the default service for ~/.claude and a hashed suffix for custom config directories.
 */
export function getKeychainServiceName(configDir: string, homeDir: string): string {
  const normalizedConfigDir = path.normalize(path.resolve(configDir));
  const normalizedDefaultDir = path.normalize(path.resolve(path.join(homeDir, '.claude')));

  if (normalizedConfigDir === normalizedDefaultDir) {
    return LEGACY_KEYCHAIN_SERVICE_NAME;
  }

  const hash = createHash('sha256').update(normalizedConfigDir).digest('hex').slice(0, 8);
  return `${LEGACY_KEYCHAIN_SERVICE_NAME}-${hash}`;
}

export function getKeychainServiceNames(
  configDir: string,
  homeDir: string,
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const serviceNames: string[] = [getKeychainServiceName(configDir, homeDir)];
  const envConfigDir = env.CLAUDE_CONFIG_DIR?.trim();

  if (envConfigDir) {
    const normalizedDefaultDir = path.normalize(path.resolve(path.join(homeDir, '.claude')));
    const normalizedEnvDir = path.normalize(path.resolve(envConfigDir));
    if (normalizedEnvDir === normalizedDefaultDir) {
      serviceNames.push(LEGACY_KEYCHAIN_SERVICE_NAME);
    } else {
      const envHash = createHash('sha256').update(envConfigDir).digest('hex').slice(0, 8);
      serviceNames.push(`${LEGACY_KEYCHAIN_SERVICE_NAME}-${envHash}`);
    }
  }

  serviceNames.push(LEGACY_KEYCHAIN_SERVICE_NAME);

  return [...new Set(serviceNames)];
}

function isMissingKeychainItemError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const maybeError = error as { status?: unknown; message?: unknown; stderr?: unknown };
  if (maybeError.status === 44) return true;

  const message = typeof maybeError.message === 'string' ? maybeError.message.toLowerCase() : '';
  if (message.includes('could not be found in the keychain')) return true;

  const stderr = typeof maybeError.stderr === 'string'
    ? maybeError.stderr.toLowerCase()
    : Buffer.isBuffer(maybeError.stderr)
      ? maybeError.stderr.toString('utf8').toLowerCase()
      : '';
  return stderr.includes('could not be found in the keychain');
}

export function resolveKeychainCredentials(
  serviceNames: string[],
  now: number,
  loadService: (serviceName: string) => string
): { credentials: { accessToken: string; subscriptionType: string } | null; shouldBackoff: boolean } {
  let shouldBackoff = false;

  for (const serviceName of serviceNames) {
    try {
      const keychainData = loadService(serviceName).trim();
      if (!keychainData) continue;

      const data: CredentialsFile = JSON.parse(keychainData);
      const credentials = parseCredentialsData(data, now);
      if (credentials) {
        return { credentials, shouldBackoff: false };
      }
    } catch (error) {
      if (!isMissingKeychainItemError(error)) {
        shouldBackoff = true;
      }
    }
  }

  return { credentials: null, shouldBackoff };
}

/**
 * Read credentials from macOS Keychain.
 * Claude Code stores OAuth credentials in the macOS Keychain with profile-specific service names.
 * Returns null if not on macOS or credentials not found.
 *
 * Security: Uses execFileSync with absolute path to avoid shell injection and PATH hijacking.
 */
function readKeychainCredentials(now: number, homeDir: string): { accessToken: string; subscriptionType: string } | null {
  // Only available on macOS
  if (process.platform !== 'darwin') {
    return null;
  }

  // Check backoff to avoid re-prompting on every render after a failure
  if (isKeychainBackoff(homeDir, now)) {
    debug('Keychain in backoff period, skipping');
    return null;
  }

  try {
    const configDir = getClaudeConfigDir(homeDir);
    const serviceNames = getKeychainServiceNames(configDir, homeDir);
    debug('Trying keychain service names:', serviceNames);

    const resolved = resolveKeychainCredentials(
      serviceNames,
      now,
      (serviceName) => execFileSync(
        '/usr/bin/security',
        ['find-generic-password', '-s', serviceName, '-w'],
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: KEYCHAIN_TIMEOUT_MS }
      )
    );

    if (resolved.credentials) {
      return resolved.credentials;
    }

    if (resolved.shouldBackoff) {
      recordKeychainFailure(homeDir, now);
    }
    return null;
  } catch (error) {
    // Security: Only log error message, not full error object (may contain stdout/stderr with tokens)
    const message = error instanceof Error ? error.message : 'unknown error';
    debug('Failed to read from macOS Keychain:', message);
    // Record failure for backoff to avoid re-prompting
    recordKeychainFailure(homeDir, now);
    return null;
  }
}

/**
 * Read credentials from file (legacy method).
 * Older versions of Claude Code stored credentials in {CLAUDE_CONFIG_DIR}/.credentials.json.
 */
function readFileCredentials(homeDir: string, now: number): { accessToken: string; subscriptionType: string } | null {
  const credentialsPath = path.join(getClaudeConfigDir(homeDir), '.credentials.json');

  if (!fs.existsSync(credentialsPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(credentialsPath, 'utf8');
    const data: CredentialsFile = JSON.parse(content);
    return parseCredentialsData(data, now);
  } catch (error) {
    debug('Failed to read credentials file:', error);
    return null;
  }
}

function readFileSubscriptionType(homeDir: string): string | null {
  const credentialsPath = path.join(getClaudeConfigDir(homeDir), '.credentials.json');

  if (!fs.existsSync(credentialsPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(credentialsPath, 'utf8');
    const data: CredentialsFile = JSON.parse(content);
    const subscriptionType = data.claudeAiOauth?.subscriptionType;
    const normalizedSubscriptionType = typeof subscriptionType === 'string'
      ? subscriptionType.trim()
      : '';
    if (!normalizedSubscriptionType) {
      return null;
    }
    return normalizedSubscriptionType;
  } catch (error) {
    debug('Failed to read file subscriptionType:', error);
    return null;
  }
}

/**
 * Parse and validate credentials data from either Keychain or file.
 */
function parseCredentialsData(data: CredentialsFile, now: number): { accessToken: string; subscriptionType: string } | null {
  const accessToken = data.claudeAiOauth?.accessToken;
  const subscriptionType = data.claudeAiOauth?.subscriptionType ?? '';

  if (!accessToken) {
    return null;
  }

  // Check if token is expired (expiresAt is Unix ms timestamp)
  // Use != null to handle expiresAt=0 correctly (would be expired)
  const expiresAt = data.claudeAiOauth?.expiresAt;
  if (expiresAt != null && expiresAt <= now) {
    debug('OAuth token expired');
    return null;
  }

  return { accessToken, subscriptionType };
}

/**
 * Read OAuth credentials, trying macOS Keychain first (Claude Code 2.x),
 * then falling back to file-based credentials (older versions).
 *
 * Token priority: Keychain token is authoritative (Claude Code 2.x stores current token there).
 * SubscriptionType: Can be supplemented from file if keychain lacks it (display-only field).
 */
function readCredentials(
  homeDir: string,
  now: number,
  readKeychain: (now: number, homeDir: string) => { accessToken: string; subscriptionType: string } | null
): { accessToken: string; subscriptionType: string } | null {
  // Try macOS Keychain first (Claude Code 2.x)
  const keychainCreds = readKeychain(now, homeDir);
  if (keychainCreds) {
    if (keychainCreds.subscriptionType) {
      debug('Using credentials from macOS Keychain');
      return keychainCreds;
    }
    // Keychain has token but no subscriptionType - try to supplement from file
    const fileSubscriptionType = readFileSubscriptionType(homeDir);
    if (fileSubscriptionType) {
      debug('Using keychain token with file subscriptionType');
      return {
        accessToken: keychainCreds.accessToken,
        subscriptionType: fileSubscriptionType,
      };
    }
    // No subscriptionType available - use keychain token anyway
    debug('Using keychain token without subscriptionType');
    return keychainCreds;
  }

  // Fall back to file-based credentials (older versions or non-macOS)
  const fileCreds = readFileCredentials(homeDir, now);
  if (fileCreds) {
    debug('Using credentials from file');
    return fileCreds;
  }

  return null;
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

export function getUsageApiTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.CLAUDE_HUD_USAGE_TIMEOUT_MS?.trim();
  if (!raw) return USAGE_API_TIMEOUT_MS_DEFAULT;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    debug('Invalid CLAUDE_HUD_USAGE_TIMEOUT_MS value:', raw);
    return USAGE_API_TIMEOUT_MS_DEFAULT;
  }
  return parsed;
}

export function isNoProxy(hostname: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const noProxy = env.NO_PROXY ?? env.no_proxy;
  if (!noProxy) return false;

  const host = hostname.toLowerCase();
  return noProxy.split(',').some((entry) => {
    const pattern = entry.trim().toLowerCase();
    if (!pattern) return false;
    if (pattern === '*') return true;
    if (host === pattern) return true;
    const suffix = pattern.startsWith('.') ? pattern : `.${pattern}`;
    return host.endsWith(suffix);
  });
}

export function getProxyUrl(hostname: string, env: NodeJS.ProcessEnv = process.env): URL | null {
  if (isNoProxy(hostname, env)) {
    debug('Proxy bypassed by NO_PROXY for host:', hostname);
    return null;
  }

  const proxyEnv = env.HTTPS_PROXY
    ?? env.https_proxy
    ?? env.ALL_PROXY
    ?? env.all_proxy
    ?? env.HTTP_PROXY
    ?? env.http_proxy;
  if (!proxyEnv) return null;

  try {
    const proxyUrl = new URL(proxyEnv);
    if (proxyUrl.protocol !== 'http:' && proxyUrl.protocol !== 'https:') {
      debug('Unsupported proxy protocol:', proxyUrl.protocol);
      return null;
    }
    return proxyUrl;
  } catch {
    debug('Invalid proxy URL:', proxyEnv);
    return null;
  }
}

function createProxyTunnelAgent(proxyUrl: URL): https.Agent {
  const proxyHost = proxyUrl.hostname;
  const proxyPort = Number.parseInt(proxyUrl.port || (proxyUrl.protocol === 'https:' ? '443' : '80'), 10);
  const proxyAuth = proxyUrl.username
    ? `Basic ${Buffer.from(
      `${decodeURIComponent(proxyUrl.username)}:${decodeURIComponent(proxyUrl.password || '')}`
    ).toString('base64')}`
    : null;

  return new class extends https.Agent {
    override createConnection(
      options: https.RequestOptions,
      callback?: (err: Error | null, socket: net.Socket) => void
    ): undefined {
      const targetHost = String(options.host ?? options.hostname ?? 'localhost');
      const targetPort = Number(options.port) || 443;

      let settled = false;
      const settle = (err: Error | null, socket: net.Socket): void => {
        if (settled) return;
        settled = true;
        callback?.(err, socket);
      };

      const proxySocket = proxyUrl.protocol === 'https:'
        ? tls.connect({ host: proxyHost, port: proxyPort, servername: proxyHost })
        : net.connect(proxyPort, proxyHost);

      proxySocket.once('error', (error) => {
        settle(error, proxySocket);
      });

      proxySocket.once('connect', () => {
        const connectHeaders = [
          `CONNECT ${targetHost}:${targetPort} HTTP/1.1`,
          `Host: ${targetHost}:${targetPort}`,
        ];
        if (proxyAuth) {
          connectHeaders.push(`Proxy-Authorization: ${proxyAuth}`);
        }
        connectHeaders.push('', '');

        proxySocket.write(connectHeaders.join('\r\n'));

        let responseBuffer = Buffer.alloc(0);
        const onData = (chunk: Buffer): void => {
          responseBuffer = Buffer.concat([responseBuffer, chunk]);
          const headerEndIndex = responseBuffer.indexOf('\r\n\r\n');
          if (headerEndIndex === -1) return;

          proxySocket.removeListener('data', onData);

          const headerText = responseBuffer.subarray(0, headerEndIndex).toString('utf8');
          const statusLine = headerText.split('\r\n')[0] ?? '';
          if (!/^HTTP\/1\.[01] 200 /.test(statusLine)) {
            const error = new Error(`Proxy CONNECT rejected: ${statusLine || 'unknown status'}`);
            proxySocket.destroy(error);
            settle(error, proxySocket);
            return;
          }

          const tlsSocket = tls.connect({
            socket: proxySocket,
            servername: String(options.servername ?? targetHost),
            rejectUnauthorized: options.rejectUnauthorized !== false,
          }, () => {
            settle(null, tlsSocket);
          });

          tlsSocket.once('error', (error) => {
            settle(error, tlsSocket);
          });
        };

        proxySocket.on('data', onData);
      });

      // Must not return the socket here. In Node.js _http_agent.js, createSocket()
      // calls: `if (newSocket) oncreate(null, newSocket)` — returning a truthy value
      // causes the HTTP request to be written to the raw proxy socket immediately,
      // before the CONNECT tunnel is established. Only deliver the final TLS socket
      // asynchronously via the callback after the CONNECT handshake succeeds.
      return undefined;
    }
  }();
}

function fetchUsageApi(accessToken: string): Promise<UsageApiResult> {
  return new Promise((resolve) => {
    const host = 'api.anthropic.com';
    const timeoutMs = getUsageApiTimeoutMs();
    const proxyUrl = getProxyUrl(host);
    const options = {
      hostname: host,
      path: '/api/oauth/usage',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': USAGE_API_USER_AGENT,
      },
      timeout: timeoutMs,
      agent: proxyUrl ? createProxyTunnelAgent(proxyUrl) : undefined,
    };

    if (proxyUrl) {
      debug('Using proxy for usage API:', proxyUrl.origin);
    }

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk: Buffer) => {
        data += chunk.toString();
      });

      res.on('end', () => {
        if (res.statusCode !== 200) {
          debug('API returned non-200 status:', res.statusCode);
          resolve({ data: null, error: res.statusCode ? `http-${res.statusCode}` : 'http-error' });
          return;
        }

        try {
          const parsed: UsageApiResponse = JSON.parse(data);
          resolve({ data: parsed });
        } catch (error) {
          debug('Failed to parse API response:', error);
          resolve({ data: null, error: 'parse' });
        }
      });
    });

    req.on('error', (error) => {
      debug('API request error:', error);
      resolve({ data: null, error: 'network' });
    });
    req.on('timeout', () => {
      debug('API request timeout');
      req.destroy();
      resolve({ data: null, error: 'timeout' });
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
      const lockPath = getCacheLockPath(homeDir);
      if (fs.existsSync(lockPath)) {
        fs.unlinkSync(lockPath);
      }
    } catch {
      // Ignore
    }
  }
}
