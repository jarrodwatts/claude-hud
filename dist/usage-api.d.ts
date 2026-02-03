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
}
export type UsageApiDeps = {
    homeDir: () => string;
    fetchApi: (accessToken: string) => Promise<UsageApiResult>;
    now: () => number;
    readKeychain: (now: number, homeDir: string) => {
        accessToken: string;
        subscriptionType: string;
    } | null;
};
/**
 * Get OAuth usage data from Anthropic API.
 * Returns null if user is an API user (no OAuth credentials) or credentials are expired.
 * Returns { apiUnavailable: true, ... } if API call fails (to show warning in HUD).
 *
 * Uses file-based cache since HUD runs as a new process each render (~300ms).
 * Cache TTL: 60s for success, 15s for failures.
 */
export declare function getUsage(overrides?: Partial<UsageApiDeps>): Promise<UsageData | null>;
export declare function clearCache(homeDir?: string): void;
//# sourceMappingURL=usage-api.d.ts.map