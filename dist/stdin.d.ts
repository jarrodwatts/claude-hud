import type { StdinData, UsageData } from './types.js';
/** Session cost in USD from Claude Code's internal cost tracker. */
export declare function getSessionCost(stdin: StdinData): number;
/**
 * Cache ratio: proportion of input tokens served from cache (0-100).
 * Returns null when no usage data is available.
 */
export declare function getCacheRatio(stdin: StdinData): number | null;
/**
 * Efficiency color zone based on context% + cache ratio.
 * Returns 'green', 'yellow', or 'red'.
 */
export declare function getEfficiencyZone(contextPercent: number, cacheRatio: number | null): 'green' | 'yellow' | 'red';
export declare function readStdin(): Promise<StdinData | null>;
export declare function getTotalTokens(stdin: StdinData): number;
export declare function getContextPercent(stdin: StdinData): number;
export declare function getBufferedPercent(stdin: StdinData): number;
export declare function getModelName(stdin: StdinData): string;
export declare function isBedrockModelId(modelId?: string): boolean;
export declare function getProviderLabel(stdin: StdinData): string | null;
export declare function getUsageFromStdin(stdin: StdinData): UsageData | null;
//# sourceMappingURL=stdin.d.ts.map