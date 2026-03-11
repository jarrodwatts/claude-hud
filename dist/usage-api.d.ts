import type { UsageData } from './types.js';
export type { UsageData } from './types.js';
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
    /** Retry-After header value in seconds (from 429 responses) */
    retryAfterSec?: number;
}
export declare const USAGE_API_USER_AGENT = "claude-code/2.1";
type CacheTtls = {
    cacheTtlMs: number;
    failureCacheTtlMs: number;
};
export type UsageApiDeps = {
    homeDir: () => string;
    fetchApi: (accessToken: string) => Promise<UsageApiResult>;
    now: () => number;
    readKeychain: (now: number, homeDir: string) => {
        accessToken: string;
        subscriptionType: string;
    } | null;
    ttls: CacheTtls;
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
export declare function getUsage(overrides?: Partial<UsageApiDeps>): Promise<UsageData | null>;
/**
 * Determine the macOS Keychain service name for Claude Code credentials.
 * Claude Code uses the default service for ~/.claude and a hashed suffix for custom config directories.
 */
export declare function getKeychainServiceName(configDir: string, homeDir: string): string;
export declare function getKeychainServiceNames(configDir: string, homeDir: string, env?: NodeJS.ProcessEnv): string[];
export declare function resolveKeychainCredentials(serviceNames: string[], now: number, loadService: (serviceName: string) => string): {
    credentials: {
        accessToken: string;
        subscriptionType: string;
    } | null;
    shouldBackoff: boolean;
};
export declare function getUsageApiTimeoutMs(env?: NodeJS.ProcessEnv): number;
export declare function isNoProxy(hostname: string, env?: NodeJS.ProcessEnv): boolean;
export declare function getProxyUrl(hostname: string, env?: NodeJS.ProcessEnv): URL | null;
export declare function clearCache(homeDir?: string): void;
//# sourceMappingURL=usage-api.d.ts.map