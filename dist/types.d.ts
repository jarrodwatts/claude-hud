import type { HudConfig } from './config.js';
import type { GitRepoIdentity, GitStatus } from './git.js';
import type { AuthInfo } from './auth.js';
import type { CostTotals } from './daily-cost.js';
export interface StdinData {
    session_id?: string;
    session_name?: string;
    version?: string;
    transcript_path?: string;
    cwd?: string;
    workspace?: {
        current_dir?: string;
        project_dir?: string;
        added_dirs?: string[];
        git_worktree?: string;
        repo?: GitRepoIdentity;
    } | null;
    model?: {
        id?: string;
        display_name?: string;
    };
    output_style?: {
        name?: string;
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
        five_hour?: RateLimitWindow | null;
        seven_day?: RateLimitWindow | null;
        spend_limit?: RateLimitWindow | null;
    } | null;
    prompt_cache?: {
        warm?: boolean;
        caching_observed?: boolean;
        ttl?: string;
        expires_at?: number | null;
        hit_ratio?: number | null;
    } | null;
    effort?: {
        level?: string;
    } | null;
    worktree?: {
        name?: string;
        path?: string;
        branch?: string;
    } | null;
}
interface RateLimitWindow {
    used_percentage?: number | null;
    resets_at?: number | null;
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
    lastAssistantResponseAt?: Date;
    sessionTokens?: SessionTokenUsage;
    compactionCount?: number;
    contextTokens?: number;
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
    costTotals: CostTotals | null;
    outputSpeed: number | null;
    gitStatus: GitStatus | null;
    usageData: UsageData | null;
    memoryUsage: MemoryInfo | null;
    config: HudConfig;
    extraLabel: string | null;
    authInfo?: AuthInfo | null;
}
export {};
//# sourceMappingURL=types.d.ts.map