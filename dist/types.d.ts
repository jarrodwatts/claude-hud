import type { HudConfig } from './config.js';
import type { GitStatus } from './git.js';
import type { AuthInfo } from './auth.js';
import type { ProviderQuotaData } from './provider-quota.js';
export interface StdinData {
    transcript_path?: string;
    cwd?: string;
    workspace?: {
        current_dir?: string;
        project_dir?: string;
        added_dirs?: string[];
        git_worktree?: string;
    } | null;
    model?: {
        id?: string;
        display_name?: string;
    };
    context_window?: {
        context_window_size?: number;
        total_input_tokens?: number | null;
        total_output_tokens?: number | null;
        current_usage?: {
            input_tokens?: number;
            output_tokens?: number;
            cache_creation_input_tokens?: number;
            cache_read_input_tokens?: number;
        } | null;
        used_percentage?: number | null;
        remaining_percentage?: number | null;
    };
    cost?: {
        total_cost_usd?: number | null;
        total_duration_ms?: number | null;
        total_api_duration_ms?: number | null;
        total_lines_added?: number | null;
        total_lines_removed?: number | null;
    } | null;
    rate_limits?: {
        five_hour?: {
            used_percentage?: number | null;
            resets_at?: number | null;
        } | null;
        seven_day?: {
            used_percentage?: number | null;
            resets_at?: number | null;
        } | null;
        /**
         * Model-scoped weekly windows (e.g. the Fable weekly quota shown on /usage).
         * Additive field — Claude Code's internal status schema defines it as
         * { display_name, utilization (0-100 percent), resets_at (ISO-8601) } and only
         * includes it when the server returns per-model windows.
         */
        model_scoped?: Array<{
            display_name?: string | null;
            utilization?: number | null;
            resets_at?: string | null;
        }> | null;
    } | null;
    effort?: string | {
        level?: string | null;
        [key: string]: unknown;
    } | null;
}
export interface ToolEntry {
    id: string;
    name: string;
    target?: string;
    status: 'running' | 'completed' | 'error';
    startTime: Date;
    endTime?: Date;
}
export interface AgentEntry {
    id: string;
    type: string;
    model?: string;
    description?: string;
    status: 'running' | 'completed';
    startTime: Date;
    endTime?: Date;
    background?: boolean;
}
export interface TodoItem {
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
}
export interface UsageData {
    fiveHour: number | null;
    sevenDay: number | null;
    fiveHourResetAt: Date | null;
    sevenDayResetAt: Date | null;
    balanceLabel?: string | null;
    /** Model-scoped weekly windows (e.g. Fable) from stdin rate_limits.model_scoped. */
    scopedWindows?: ScopedUsageWindow[];
}
/** One model-scoped weekly quota window (e.g. label "Fable", used percent 0-100). */
export interface ScopedUsageWindow {
    label: string;
    percent: number | null;
    resetAt: Date | null;
}
export interface ExternalUsageSnapshot {
    five_hour?: {
        used_percentage?: number | null;
        resets_at?: string | number | null;
    } | null;
    seven_day?: {
        used_percentage?: number | null;
        resets_at?: string | number | null;
    } | null;
    updated_at?: string | number | null;
    balance_label?: string | null;
    /**
     * Model-scoped weekly windows (e.g. Fable). Mirrors the stdin
     * `rate_limits.model_scoped` schema so external feeders can pass through
     * the same shape Claude Code emits (e.g. from a get_usage response).
     */
    model_scoped?: Array<{
        display_name?: string | null;
        utilization?: number | null;
        resets_at?: string | null;
    }> | null;
}
export interface MemoryInfo {
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
    usedPercent: number;
}
/** Check if usage limit is reached (either window at 100%) */
export declare function isLimitReached(data: UsageData): boolean;
export interface SessionTokenUsage {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
}
export interface TranscriptData {
    tools: ToolEntry[];
    skills: string[];
    mcpServers: string[];
    /**
     * MCP servers whose latest observed tool result is an error, derived
     * from `mcp__<server>__<tool>` results carrying is_error. Distinct from
     * mcpServers, which is a plain activity list.
     */
    mcpErrors: string[];
    agents: AgentEntry[];
    todos: TodoItem[];
    sessionStart?: Date;
    sessionName?: string;
    lastAssistantResponseAt?: Date;
    sessionTokens?: SessionTokenUsage;
    lastCompactBoundaryAt?: Date;
    lastCompactPostTokens?: number;
    compactionCount?: number;
    advisorModel?: string;
    ultracodeActive?: boolean;
    lastAssistantModel?: string;
}
export interface RenderContext {
    stdin: StdinData;
    transcript: TranscriptData;
    claudeMdCount: number;
    rulesCount: number;
    mcpCount: number;
    hooksCount: number;
    sessionDuration: string;
    gitStatus: GitStatus | null;
    usageData: UsageData | null;
    memoryUsage: MemoryInfo | null;
    config: HudConfig;
    extraLabel: string | null;
    outputStyle?: string;
    claudeCodeVersion?: string;
    effortLevel?: string;
    effortSymbol?: string;
    authInfo?: AuthInfo | null;
    providerQuotaData?: ProviderQuotaData | null;
}
//# sourceMappingURL=types.d.ts.map