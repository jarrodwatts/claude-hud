import type { StdinData } from './types.js';
import type { HudConfig } from './config.js';
export declare function readStdin(): Promise<StdinData | null>;
export declare function getTotalTokens(stdin: StdinData): number;
/**
 * Get the effective context window size, checking for model-based overrides.
 * Matching order: model.id → model.display_name → getModelName() (normalized).
 * Priority: exact match first, then longer substring patterns first.
 */
export declare function getEffectiveContextSize(stdin: StdinData, config?: HudConfig): number;
export declare function getContextPercent(stdin: StdinData, config?: HudConfig): number;
export declare function getBufferedPercent(stdin: StdinData, config?: HudConfig): number;
export declare function getModelName(stdin: StdinData): string;
export declare function isBedrockModelId(modelId?: string): boolean;
export declare function getProviderLabel(stdin: StdinData): string | null;
//# sourceMappingURL=stdin.d.ts.map