import type { HudConfig } from './config.js';
import type { GitRepoIdentity, GitStatus } from './git.js';
import type { AuthInfo } from './auth.js';
import type { CostTotals } from './daily-cost.js';

// The statusline payload Claude Code writes to stdin (code.claude.com/docs/en/statusline).
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
  output_style?: { name?: string };
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
  effort?: { level?: string } | null;
  worktree?: { name?: string; path?: string; branch?: string } | null;
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
  fiveHour: number | null;  // 0-100 percentage, null if unavailable
  sevenDay: number | null;  // 0-100 percentage, null if unavailable
  fiveHourResetAt: Date | null;
  sevenDayResetAt: Date | null;
  balanceLabel?: string | null;  // optional raw balance text (e.g. "¥6.35")
  // Model-scoped weekly windows (e.g. Fable), from the external usage snapshot.
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
  // Model-scoped weekly windows (e.g. Fable), in the shape of Claude Code's /usage data.
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
export function isLimitReached(data: UsageData): boolean {
  return data.fiveHour === 100 || data.sevenDay === 100;
}

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
  // Last assistant response of any kind, subagents included. Drives the
  // last-response element.
  lastAssistantResponseAt?: Date;
  sessionTokens?: SessionTokenUsage;
  // Number of compact_boundary entries (manual /compact or auto compaction)
  // with a valid timestamp seen in the transcript.
  compactionCount?: number;
  // Tokens in the main conversation's context as of its last request, or the
  // post-compaction size after a compact boundary.
  contextTokens?: number;
  // Advisor model ID for the current session, captured from the top-level
  // `advisorModel` field that Claude Code stamps onto every assistant record
  // after `/advisor` is set (e.g. "claude-opus-4-7"). undefined when /advisor
  // is off or no assistant turn has happened yet.
  advisorModel?: string;
  // Current ultracode effort state from the most recent transcript signal
  // (`ultra_effort_enter`/`ultra_effort_exit` attachment or `/effort` output).
  // undefined when ultracode was never entered this session.
  ultracodeActive?: boolean;
  // Model ID from the most recent assistant message's `message.model` field.
  // This reflects what the API actually served — may differ from stdin.model
  // when a proxy (e.g. cc-switch) routes to a different model. Transcript
  // parsing sanitizes terminal controls and caps the retained value at 80 chars.
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
