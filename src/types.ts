import type { HudConfig } from './config.js';
import type { GitStatus } from './git.js';

export interface StdinData {
  transcript_path?: string;
  cwd?: string;
  model?: {
    id?: string;
    display_name?: string;
  };
  context_window?: {
    context_window_size?: number;
    current_usage?: {
      input_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    } | null;
    // Native percentage fields (Claude Code v2.1.6+)
    used_percentage?: number | null;
    remaining_percentage?: number | null;
  };
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
}

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

/** Usage window data from the OAuth API */
export interface UsageWindow {
  utilization: number | null;  // 0-100 percentage, null if unavailable
  resetAt: Date | null;
}

export interface UsageData {
  planName: string | null;  // 'Max', 'Pro', or null for API users
  fiveHour: number | null;  // 0-100 percentage, null if unavailable
  sevenDay: number | null;  // 0-100 percentage, null if unavailable
  fiveHourResetAt: Date | null;
  sevenDayResetAt: Date | null;
  apiUnavailable?: boolean; // true if API call failed (user should check DEBUG logs)
  apiError?: string; // short error reason (e.g., 401, timeout)
}

/** Check if usage limit is reached (either window at 100%) */
export function isLimitReached(data: UsageData): boolean {
  return data.fiveHour === 100 || data.sevenDay === 100;
}

export interface TranscriptData {
  tools: ToolEntry[];
  agents: AgentEntry[];
  todos: TodoItem[];
  sessionStart?: Date;
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
  config: HudConfig;
  extraLabel: string | null;
}
