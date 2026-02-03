import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';
import { execFileSync } from 'child_process';
import { createDebug } from './debug.js';
const debug = createDebug('usage');
// File-based cache (HUD runs as new process each render, so in-memory cache won't persist)
const CACHE_TTL_MS = 60_000; // 60 seconds
const CACHE_FAILURE_TTL_MS = 15_000; // 15 seconds for failed requests
const KEYCHAIN_TIMEOUT_MS = 5000;
const KEYCHAIN_BACKOFF_MS = 60_000; // Backoff on keychain failures to avoid re-prompting
function getCachePath(homeDir) {
    return path.join(homeDir, '.claude', 'plugins', 'claude-hud', '.usage-cache.json');
}
function readCache(homeDir, now) {
    try {
        const cachePath = getCachePath(homeDir);
        if (!fs.existsSync(cachePath))
            return null;
        const content = fs.readFileSync(cachePath, 'utf8');
        const cache = JSON.parse(content);
        // Check TTL - use shorter TTL for failure results
        const ttl = cache.data.apiUnavailable ? CACHE_FAILURE_TTL_MS : CACHE_TTL_MS;
        if (now - cache.timestamp >= ttl)
            return null;
        // JSON.stringify converts Date to ISO string, so we need to reconvert on read.
        // new Date() handles both Date objects and ISO strings safely.
        const data = cache.data;
        if (data.fiveHourResetAt) {
            data.fiveHourResetAt = new Date(data.fiveHourResetAt);
        }
        if (data.sevenDayResetAt) {
            data.sevenDayResetAt = new Date(data.sevenDayResetAt);
        }
        return data;
    }
    catch {
        return null;
    }
}
function writeCache(homeDir, data, timestamp) {
    try {
        const cachePath = getCachePath(homeDir);
        const cacheDir = path.dirname(cachePath);
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
        }
        const cache = { data, timestamp };
        fs.writeFileSync(cachePath, JSON.stringify(cache), 'utf8');
    }
    catch {
        // Ignore cache write failures
    }
}
const defaultDeps = {
    homeDir: () => os.homedir(),
    fetchApi: fetchUsageApi,
    now: () => Date.now(),
    readKeychain: readKeychainCredentials,
};
/**
 * Get OAuth usage data from Anthropic API.
 * Returns null if user is an API user (no OAuth credentials) or credentials are expired.
 * Returns { apiUnavailable: true, ... } if API call fails (to show warning in HUD).
 *
 * Uses file-based cache since HUD runs as a new process each render (~300ms).
 * Cache TTL: 60s for success, 15s for failures.
 */
export async function getUsage(overrides = {}) {
    const deps = { ...defaultDeps, ...overrides };
    const now = deps.now();
    const homeDir = deps.homeDir();
    // Check file-based cache first
    const cached = readCache(homeDir, now);
    if (cached) {
        return cached;
    }
    try {
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
            const failureResult = {
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
        const result = {
            planName,
            fiveHour,
            sevenDay,
            fiveHourResetAt,
            sevenDayResetAt,
        };
        // Write to file cache
        writeCache(homeDir, result, now);
        return result;
    }
    catch (error) {
        debug('getUsage failed:', error);
        return null;
    }
}
/**
 * Get path for keychain failure backoff cache.
 * Separate from usage cache to track keychain-specific failures.
 */
function getKeychainBackoffPath(homeDir) {
    return path.join(homeDir, '.claude', 'plugins', 'claude-hud', '.keychain-backoff');
}
/**
 * Check if we're in keychain backoff period (recent failure/timeout).
 * Prevents re-prompting user on every render cycle.
 */
function isKeychainBackoff(homeDir, now) {
    try {
        const backoffPath = getKeychainBackoffPath(homeDir);
        if (!fs.existsSync(backoffPath))
            return false;
        const timestamp = parseInt(fs.readFileSync(backoffPath, 'utf8'), 10);
        return now - timestamp < KEYCHAIN_BACKOFF_MS;
    }
    catch {
        return false;
    }
}
/**
 * Record keychain failure for backoff.
 */
function recordKeychainFailure(homeDir, now) {
    try {
        const backoffPath = getKeychainBackoffPath(homeDir);
        const dir = path.dirname(backoffPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(backoffPath, String(now), 'utf8');
    }
    catch {
        // Ignore write failures
    }
}
/**
 * Read credentials from macOS Keychain.
 * Claude Code 2.x stores OAuth credentials in the macOS Keychain under "Claude Code-credentials".
 * Returns null if not on macOS or credentials not found.
 *
 * Security: Uses execFileSync with absolute path to avoid shell injection and PATH hijacking.
 */
function readKeychainCredentials(now, homeDir) {
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
        // Read from macOS Keychain using security command
        // Security: Use execFileSync with absolute path and args array (no shell)
        const keychainData = execFileSync('/usr/bin/security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: KEYCHAIN_TIMEOUT_MS }).trim();
        if (!keychainData) {
            return null;
        }
        const data = JSON.parse(keychainData);
        return parseCredentialsData(data, now);
    }
    catch (error) {
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
 * Older versions of Claude Code stored credentials in ~/.claude/.credentials.json
 */
function readFileCredentials(homeDir, now) {
    const credentialsPath = path.join(homeDir, '.claude', '.credentials.json');
    if (!fs.existsSync(credentialsPath)) {
        return null;
    }
    try {
        const content = fs.readFileSync(credentialsPath, 'utf8');
        const data = JSON.parse(content);
        return parseCredentialsData(data, now);
    }
    catch (error) {
        debug('Failed to read credentials file:', error);
        return null;
    }
}
/**
 * Parse and validate credentials data from either Keychain or file.
 */
function parseCredentialsData(data, now) {
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
function readCredentials(homeDir, now, readKeychain) {
    // Try macOS Keychain first (Claude Code 2.x)
    const keychainCreds = readKeychain(now, homeDir);
    if (keychainCreds) {
        if (keychainCreds.subscriptionType) {
            debug('Using credentials from macOS Keychain');
            return keychainCreds;
        }
        // Keychain has token but no subscriptionType - try to supplement from file
        const fileCreds = readFileCredentials(homeDir, now);
        if (fileCreds?.subscriptionType) {
            debug('Using keychain token with file subscriptionType');
            return {
                accessToken: keychainCreds.accessToken,
                subscriptionType: fileCreds.subscriptionType,
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
function getPlanName(subscriptionType) {
    const lower = subscriptionType.toLowerCase();
    if (lower.includes('max'))
        return 'Max';
    if (lower.includes('pro'))
        return 'Pro';
    if (lower.includes('team'))
        return 'Team';
    // API users don't have subscriptionType or have 'api'
    if (!subscriptionType || lower.includes('api'))
        return null;
    // Unknown subscription type - show it capitalized
    return subscriptionType.charAt(0).toUpperCase() + subscriptionType.slice(1);
}
/** Parse utilization value, clamping to 0-100 and handling NaN/Infinity */
function parseUtilization(value) {
    if (value == null)
        return null;
    if (!Number.isFinite(value))
        return null; // Handles NaN and Infinity
    return Math.round(Math.max(0, Math.min(100, value)));
}
/** Parse ISO date string safely, returning null for invalid dates */
function parseDate(dateStr) {
    if (!dateStr)
        return null;
    const date = new Date(dateStr);
    // Check for Invalid Date
    if (isNaN(date.getTime())) {
        debug('Invalid date string:', dateStr);
        return null;
    }
    return date;
}
function fetchUsageApi(accessToken) {
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
            res.on('data', (chunk) => {
                data += chunk.toString();
            });
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    debug('API returned non-200 status:', res.statusCode);
                    resolve({ data: null, error: res.statusCode ? `http-${res.statusCode}` : 'http-error' });
                    return;
                }
                try {
                    const parsed = JSON.parse(data);
                    resolve({ data: parsed });
                }
                catch (error) {
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
export function clearCache(homeDir) {
    if (homeDir) {
        try {
            const cachePath = getCachePath(homeDir);
            if (fs.existsSync(cachePath)) {
                fs.unlinkSync(cachePath);
            }
        }
        catch {
            // Ignore
        }
    }
}
//# sourceMappingURL=usage-api.js.map