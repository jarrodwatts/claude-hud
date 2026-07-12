import type { StdinData, UsageData } from './types.js';
import type { ModelFormatMode } from './config.js';
type StdinStream = Pick<NodeJS.ReadStream, 'setEncoding' | 'on' | 'off' | 'pause'> & {
    isTTY?: boolean;
};
type ReadStdinOptions = {
    firstByteTimeoutMs?: number;
    idleTimeoutMs?: number;
    maxBytes?: number;
};
export declare function readStdin(stream?: StdinStream, options?: ReadStdinOptions): Promise<StdinData | null>;
export declare function getTotalTokens(stdin: StdinData): number;
export declare function getContextPercent(stdin: StdinData, autoCompactWindow?: number | null): number;
export declare function getBufferedPercent(stdin: StdinData, autoCompactWindow?: number | null): number;
export declare function getModelName(stdin: StdinData): string;
export declare function isBedrockModelId(modelId?: string): boolean;
export declare function isVertexModelId(modelId?: string): boolean;
export declare function isEnterpriseModelId(modelId?: string): boolean;
export declare function getProviderLabel(stdin: StdinData): string | null;
export declare function shouldHideUsage(stdin: StdinData): boolean;
type ModelScopedStdinEntry = NonNullable<NonNullable<StdinData['rate_limits']>['model_scoped']>[number];
/**
 * Parses `rate_limits.model_scoped` (Claude Code 2.1.206+ schema, currently
 * feature-gated and not emitted) into the HUD's internal per-model usage
 * shape. Entries missing a usable display_name or a finite utilization are
 * dropped; percentages are clamped to 0-100 and rounded; labels are
 * sanitized against escape/control-char injection and length-capped.
 */
export declare function parseModelScopedFromStdin(entries: ModelScopedStdinEntry[] | null | undefined): NonNullable<UsageData['modelScoped']>;
export declare function getUsageFromStdin(stdin: StdinData): UsageData | null;
/**
 * Strips redundant context-window size suffixes from model display names.
 *
 * Claude Code may include the context window size in the display name
 * (e.g. "Opus 4.6 (1M context)"), but the HUD already shows context
 * usage via the context bar — so the parenthetical is redundant.
 */
export declare function stripContextSuffix(name: string): string;
/**
 * Formats a model name according to the user's chosen display settings.
 *
 * When `override` is set, it replaces the model name entirely.
 * Otherwise, `format` controls how the raw name is abbreviated:
 *
 *   full:    Return raw name unchanged   (e.g. "Opus 4.6 (1M context)")
 *   compact: Strip context-window suffix (e.g. "Opus 4.6")
 *   short:   Strip context suffix AND leading "Claude " prefix (e.g. "Opus 4.6")
 */
export declare function formatModelName(name: string, format?: ModelFormatMode, override?: string): string;
export {};
//# sourceMappingURL=stdin.d.ts.map