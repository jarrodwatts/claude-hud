import type { UsageData } from './types.js';

/**
 * Default API endpoint for MiniMax (China) subscription usage.
 * Users can override this via config.miniMaxUsageApi.apiUrl.
 */
export const DEFAULT_MINIMAX_API_URL = 'https://www.minimaxi.com/v1/api/openplatform/coding_plan/remains';

/** Default request timeout in milliseconds. */
const DEFAULT_TIMEOUT_MS = 10_000;

interface MiniMaxModelRemain {
  model_name: string;
  current_interval_total_count: number;
  current_interval_usage_count: number;
  remains_time: number;
  start_time: number;
  end_time: number;
  current_weekly_total_count: number;
  current_weekly_usage_count: number;
  weekly_remains_time: number;
  weekly_start_time: number;
  weekly_end_time: number;
}

interface MiniMaxApiResponse {
  model_remains: MiniMaxModelRemain[];
  base_resp: MiniMaxApiStatus;
}

interface MiniMaxApiStatus {
  status_code: number;
  status_msg: string;
}

// Target model patterns to look for (in order of preference)
const TARGET_MODEL_PATTERNS = [
  /^minimax-m\s*\*/i,
  /^minimax-m2/i,
  /^minimax/i,
];

// Cache
let cachedData: UsageData | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 60_000; // 60 seconds

/**
 * Checks if a model name matches MiniMax (China) subscription models.
 * Matches patterns like "MiniMax-M*", "MiniMax-M2", etc.
 */
function matchModel(modelName: string): boolean {
  const lower = modelName.toLowerCase();
  return TARGET_MODEL_PATTERNS.some(pattern => pattern.test(lower));
}

/**
 * Parses the MiniMax API response into UsageData format.
 *
 * Note: The API returns remaining quota (not used), so we compute:
 *   used = total - remaining
 *
 * @param data - The parsed API response
 * @param nowMs - Current timestamp in milliseconds (for reset time calculation)
 * @returns UsageData or null if parsing fails or no matching model found
 */
function parseApiResponse(data: MiniMaxApiResponse, nowMs: number): UsageData | null {
  if (data.base_resp.status_code !== 0) {
    return null;
  }

  // Find the best matching model
  const modelEntry = data.model_remains.find(entry => matchModel(entry.model_name));
  if (!modelEntry) {
    return null;
  }

  const { current_interval_total_count, current_interval_usage_count, end_time, remains_time } = modelEntry;

  // Calculate percentage: usage_count is REMAINING, so used = total - remaining
  let fiveHour: number | null = null;
  if (current_interval_total_count > 0) {
    const used = current_interval_total_count - current_interval_usage_count;
    fiveHour = Math.round((used / current_interval_total_count) * 100);
    fiveHour = Math.min(100, Math.max(0, fiveHour));
  }

  // Weekly: usage_count is REMAINING
  let sevenDay: number | null = null;
  if (modelEntry.current_weekly_total_count > 0) {
    const weeklyUsed = modelEntry.current_weekly_total_count - modelEntry.current_weekly_usage_count;
    sevenDay = Math.round((weeklyUsed / modelEntry.current_weekly_total_count) * 100);
    sevenDay = Math.min(100, Math.max(0, sevenDay));
  }

  // Reset time: use end_time if available, otherwise estimate from remains_time
  let fiveHourResetAt: Date | null = null;
  if (end_time > 0) {
    fiveHourResetAt = new Date(end_time);
  } else if (remains_time > 0) {
    fiveHourResetAt = new Date(nowMs + remains_time);
  }

  return {
    fiveHour,
    sevenDay,
    fiveHourResetAt,
    sevenDayResetAt: null,
  };
}

/**
 * Fetches subscription usage data from the MiniMax (China) API.
 *
 * Uses a 60-second cache to avoid excessive API calls. Returns cached
 * data on network errors to prevent stale UI updates.
 *
 * @param apiKey - Bearer token for authentication
 * @param apiUrl - Optional custom API URL (defaults to DEFAULT_MINIMAX_API_URL)
 * @param timeoutMs - Request timeout in milliseconds (default: 10000)
 * @returns UsageData or null if the request fails or no matching model is found
 */
export async function fetchMiniMaxUsage(
  apiKey: string,
  apiUrl?: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<UsageData | null> {
  const nowMs = Date.now();

  // Return cached data if still valid
  if (cachedData && (nowMs - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedData;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(apiUrl ?? DEFAULT_MINIMAX_API_URL, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return cachedData; // Return stale cache on error
    }

    const data = await response.json() as MiniMaxApiResponse;
    const parsed = parseApiResponse(data, nowMs);

    if (parsed) {
      cachedData = parsed;
      cacheTimestamp = nowMs;
    }

    return parsed;
  } catch {
    return cachedData; // Return stale cache on error
  }
}

/** Clears the cached MiniMax usage data. Useful for testing. */
export function clearMiniMaxCache(): void {
  cachedData = null;
  cacheTimestamp = 0;
}
