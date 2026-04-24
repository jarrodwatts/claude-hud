import * as fs from 'fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'readline';
import { createHash } from 'node:crypto';
import { getHudPluginDir } from './claude-config-dir.js';
import type { TranscriptData, ToolEntry, AgentEntry, TodoItem, SessionTokenUsage } from './types.js';

interface TranscriptLine {
  timestamp?: string;
  type?: string;
  subtype?: string;
  slug?: string;
  customTitle?: string;
  message?: {
    content?: ContentBlock[];
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  compactMetadata?: {
    trigger?: string;
    preTokens?: number;
    postTokens?: number;
    durationMs?: number;
  };
}

interface ContentBlock {
  type: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  is_error?: boolean;
}

interface TranscriptFileState {
  mtimeMs: number;
  size: number;
}

interface SerializedToolEntry extends Omit<ToolEntry, 'startTime' | 'endTime'> {
  startTime: string;
  endTime?: string;
}

interface SerializedAgentEntry extends Omit<AgentEntry, 'startTime' | 'endTime'> {
  startTime: string;
  endTime?: string;
}

interface SerializedTranscriptData {
  tools: SerializedToolEntry[];
  agents: SerializedAgentEntry[];
  todos: TodoItem[];
  sessionStart?: string;
  sessionName?: string;
  lastAssistantResponseAt?: string;
  sessionTokens?: SessionTokenUsage;
  lastCompactBoundaryAt?: string;
  lastCompactPostTokens?: number;
}

interface TranscriptCacheFile {
  version?: number;
  transcriptPath: string;
  transcriptState: TranscriptFileState;
  data: SerializedTranscriptData;
}

const TRANSCRIPT_CACHE_VERSION = 3;

let createReadStreamImpl: typeof fs.createReadStream = fs.createReadStream;

function normalizeTokenCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.trunc(value));
}

function normalizeSessionTokens(tokens: unknown): SessionTokenUsage | undefined {
  if (!tokens || typeof tokens !== 'object') {
    return undefined;
  }

  const raw = tokens as Record<string, unknown>;
  return {
    inputTokens: normalizeTokenCount(raw.inputTokens),
    outputTokens: normalizeTokenCount(raw.outputTokens),
    cacheCreationTokens: normalizeTokenCount(raw.cacheCreationTokens),
    cacheReadTokens: normalizeTokenCount(raw.cacheReadTokens),
  };
}

function getTranscriptCachePath(transcriptPath: string, homeDir: string): string {
  const hash = createHash('sha256').update(path.resolve(transcriptPath)).digest('hex');
  return path.join(getHudPluginDir(homeDir), 'transcript-cache', `${hash}.json`);
}

function canonicalizeTranscriptPath(transcriptPath: string): string | null {
  try {
    return fs.realpathSync(transcriptPath);
  } catch {
    return null;
  }
}

function readTranscriptFileState(transcriptPath: string): TranscriptFileState | null {
  try {
    const stat = fs.statSync(transcriptPath);
    if (!stat.isFile()) {
      return null;
    }
    return {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
    };
  } catch {
    return null;
  }
}

function serializeTranscriptData(data: TranscriptData): SerializedTranscriptData {
  return {
    tools: data.tools.map((tool) => ({
      ...tool,
      startTime: tool.startTime.toISOString(),
      endTime: tool.endTime?.toISOString(),
    })),
    agents: data.agents.map((agent) => ({
      ...agent,
      startTime: agent.startTime.toISOString(),
      endTime: agent.endTime?.toISOString(),
    })),
    todos: data.todos.map((todo) => ({ ...todo })),
    sessionStart: data.sessionStart?.toISOString(),
    sessionName: data.sessionName,
    lastAssistantResponseAt: data.lastAssistantResponseAt?.toISOString(),
    sessionTokens: data.sessionTokens,
    lastCompactBoundaryAt: data.lastCompactBoundaryAt?.toISOString(),
    lastCompactPostTokens: data.lastCompactPostTokens,
  };
}

function deserializeTranscriptData(data: SerializedTranscriptData): TranscriptData {
  return {
    tools: data.tools.map((tool) => ({
      ...tool,
      startTime: new Date(tool.startTime),
      endTime: tool.endTime ? new Date(tool.endTime) : undefined,
    })),
    agents: data.agents.map((agent) => ({
      ...agent,
      startTime: new Date(agent.startTime),
      endTime: agent.endTime ? new Date(agent.endTime) : undefined,
    })),
    todos: data.todos.map((todo) => ({ ...todo })),
    sessionStart: data.sessionStart ? new Date(data.sessionStart) : undefined,
    sessionName: data.sessionName,
    lastAssistantResponseAt: data.lastAssistantResponseAt ? new Date(data.lastAssistantResponseAt) : undefined,
    sessionTokens: normalizeSessionTokens(data.sessionTokens),
    lastCompactBoundaryAt: data.lastCompactBoundaryAt ? new Date(data.lastCompactBoundaryAt) : undefined,
    lastCompactPostTokens: typeof data.lastCompactPostTokens === 'number' ? data.lastCompactPostTokens : undefined,
  };
}

function readTranscriptCache(transcriptPath: string, state: TranscriptFileState): TranscriptData | null {
  try {
    const cachePath = getTranscriptCachePath(transcriptPath, os.homedir());
    const raw = fs.readFileSync(cachePath, 'utf8');
    const parsed = JSON.parse(raw) as TranscriptCacheFile;
    if (
      parsed.version !== TRANSCRIPT_CACHE_VERSION
      || !parsed.data
      || !parsed.transcriptPath
      || parsed.transcriptPath !== path.resolve(transcriptPath)
      || parsed.transcriptState?.mtimeMs !== state.mtimeMs
      || parsed.transcriptState?.size !== state.size
    ) {
      return null;
    }

    return deserializeTranscriptData(parsed.data);
  } catch {
    return null;
  }
}

function writeTranscriptCache(transcriptPath: string, state: TranscriptFileState, data: TranscriptData): void {
  try {
    const cachePath = getTranscriptCachePath(transcriptPath, os.homedir());
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    const payload: TranscriptCacheFile = {
      version: TRANSCRIPT_CACHE_VERSION,
      transcriptPath: path.resolve(transcriptPath),
      transcriptState: state,
      data: serializeTranscriptData(data),
    };
    fs.writeFileSync(cachePath, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 });
  } catch {
    // Cache failures are non-fatal; fall back to fresh parsing next time.
  }
}

export async function parseTranscript(transcriptPath: string): Promise<TranscriptData> {
  const result: TranscriptData = {
    tools: [],
    agents: [],
    todos: [],
  };

  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    return result;
  }

  const canonicalTranscriptPath = canonicalizeTranscriptPath(transcriptPath);
  if (!canonicalTranscriptPath) {
    return result;
  }

  const transcriptState = readTranscriptFileState(canonicalTranscriptPath);
  if (!transcriptState) {
    return result;
  }

  const cached = readTranscriptCache(canonicalTranscriptPath, transcriptState);
  if (cached) {
    return cached;
  }

  const toolMap = new Map<string, ToolEntry>();
  const agentMap = new Map<string, AgentEntry>();
  let latestTodos: TodoItem[] = [];
  const taskIdToIndex = new Map<string, number>();
  let latestSlug: string | undefined;
  let customTitle: string | undefined;
  let lastCompactBoundaryAt: Date | undefined;
  let lastCompactPostTokens: number | undefined;
  const sessionTokens: SessionTokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
  };

  let parsedCleanly = false;

  try {
    const fileStream = createReadStreamImpl(canonicalTranscriptPath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) continue;

      try {
        const entry = JSON.parse(line) as TranscriptLine;
        if (entry.type === 'custom-title' && typeof entry.customTitle === 'string') {
          customTitle = entry.customTitle;
        } else if (typeof entry.slug === 'string') {
          latestSlug = entry.slug;
        }
        // Accumulate token usage from assistant messages
        if (entry.type === 'assistant' && entry.message?.usage) {
          const usage = entry.message.usage;
          sessionTokens.inputTokens += normalizeTokenCount(usage.input_tokens);
          sessionTokens.outputTokens += normalizeTokenCount(usage.output_tokens);
          sessionTokens.cacheCreationTokens += normalizeTokenCount(usage.cache_creation_input_tokens);
          sessionTokens.cacheReadTokens += normalizeTokenCount(usage.cache_read_input_tokens);
        }
        // Track Claude Code's compact_boundary marker. Both manual (/compact)
        // and auto compaction emit this system entry with compactMetadata; we
        // take the most recent one's timestamp so callers can distinguish a
        // legitimate post-compact zero frame from a transient stdin glitch.
        if (entry.type === 'system' && entry.subtype === 'compact_boundary') {
          const ts = entry.timestamp ? new Date(entry.timestamp) : null;
          if (ts && !Number.isNaN(ts.getTime())) {
            if (!lastCompactBoundaryAt || ts.getTime() > lastCompactBoundaryAt.getTime()) {
              lastCompactBoundaryAt = ts;
              const post = entry.compactMetadata?.postTokens;
              lastCompactPostTokens = typeof post === 'number' && Number.isFinite(post) && post >= 0
                ? Math.trunc(post)
                : undefined;
            }
          }
        }
        processEntry(entry, toolMap, agentMap, taskIdToIndex, latestTodos, result);
      } catch {
        // Skip malformed lines
      }
    }

    parsedCleanly = true;
  } catch {
    // Return partial results on error
  }

  result.tools = Array.from(toolMap.values()).slice(-20);
  result.agents = Array.from(agentMap.values()).slice(-10);
  result.todos = latestTodos;
  result.sessionName = customTitle ?? latestSlug;
  result.sessionTokens = sessionTokens;
  result.lastCompactBoundaryAt = lastCompactBoundaryAt;
  result.lastCompactPostTokens = lastCompactPostTokens;
  if (parsedCleanly) {
    writeTranscriptCache(canonicalTranscriptPath, transcriptState, result);
  }

  return result;
}

export function _setCreateReadStreamForTests(impl: typeof fs.createReadStream | null): void {
  createReadStreamImpl = impl ?? fs.createReadStream;
}

function processEntry(
  entry: TranscriptLine,
  toolMap: Map<string, ToolEntry>,
  agentMap: Map<string, AgentEntry>,
  taskIdToIndex: Map<string, number>,
  latestTodos: TodoItem[],
  result: TranscriptData
): void {
  const timestamp = entry.timestamp ? new Date(entry.timestamp) : new Date();
  const hasValidTimestamp = !Number.isNaN(timestamp.getTime());

  if (!result.sessionStart && entry.timestamp && hasValidTimestamp) {
    result.sessionStart = timestamp;
  }

  if (entry.type === 'assistant' && entry.timestamp && hasValidTimestamp) {
    result.lastAssistantResponseAt = timestamp;
  }

  const content = entry.message?.content;
  if (!content || !Array.isArray(content)) return;

  for (const block of content) {
    if (block.type === 'tool_use' && block.id && block.name) {
      const toolEntry: ToolEntry = {
        id: block.id,
        name: block.name,
        target: extractTarget(block.name, block.input),
        status: 'running',
        startTime: timestamp,
      };

      if (block.name === 'Task' || block.name === 'Agent') {
        const input = block.input as Record<string, unknown>;
        const agentEntry: AgentEntry = {
          id: block.id,
          type: (input?.subagent_type as string) ?? 'agent',
          model: (input?.model as string) ?? undefined,
          description: (input?.description as string) ?? undefined,
          status: 'running',
          startTime: timestamp,
        };
        agentMap.set(block.id, agentEntry);
      } else if (block.name === 'TodoWrite') {
        const input = block.input as { todos?: TodoItem[] };
        if (input?.todos && Array.isArray(input.todos)) {
          // Build a FIFO queue of taskIds per content string, ordered by the
          // old array position. Two todos that share the same content must
          // each get their own taskId back after the rebuild, so we cannot
          // collapse duplicates to one index.
          const contentToTaskIds = new Map<string, string[]>();
          const taskIdsByOldIndex: Array<[number, string]> = [];
          for (const [taskId, idx] of taskIdToIndex) {
            if (idx < latestTodos.length) {
              taskIdsByOldIndex.push([idx, taskId]);
            }
          }
          taskIdsByOldIndex.sort((a, b) => a[0] - b[0]);
          for (const [idx, taskId] of taskIdsByOldIndex) {
            const content = latestTodos[idx].content;
            const ids = contentToTaskIds.get(content) ?? [];
            ids.push(taskId);
            contentToTaskIds.set(content, ids);
          }

          latestTodos.length = 0;
          taskIdToIndex.clear();
          latestTodos.push(...input.todos);

          // Consume one queued taskId per new todo that matches by content,
          // so duplicate-content items still each get their own taskId.
          for (let i = 0; i < latestTodos.length; i++) {
            const ids = contentToTaskIds.get(latestTodos[i].content);
            if (ids && ids.length > 0) {
              const taskId = ids.shift() as string;
              taskIdToIndex.set(taskId, i);
              if (ids.length === 0) {
                contentToTaskIds.delete(latestTodos[i].content);
              }
            }
          }
        }
      } else if (block.name === 'TaskCreate') {
        const input = block.input as Record<string, unknown>;
        const subject = typeof input?.subject === 'string' ? input.subject : '';
        const description = typeof input?.description === 'string' ? input.description : '';
        const content = subject || description || 'Untitled task';
        const status = normalizeTaskStatus(input?.status) ?? 'pending';
        latestTodos.push({ content, status });

        const rawTaskId = input?.taskId;
        const taskId = typeof rawTaskId === 'string' || typeof rawTaskId === 'number'
          ? String(rawTaskId)
          : block.id;
        if (taskId) {
          taskIdToIndex.set(taskId, latestTodos.length - 1);
        }
      } else if (block.name === 'TaskUpdate') {
        const input = block.input as Record<string, unknown>;
        const index = resolveTaskIndex(input?.taskId, taskIdToIndex, latestTodos);
        if (index !== null) {
          const status = normalizeTaskStatus(input?.status);
          if (status) {
            latestTodos[index].status = status;
          }

          const subject = typeof input?.subject === 'string' ? input.subject : '';
          const description = typeof input?.description === 'string' ? input.description : '';
          const content = subject || description;
          if (content) {
            latestTodos[index].content = content;
          }
        }
      } else {
        toolMap.set(block.id, toolEntry);
      }
    }

    if (block.type === 'tool_result' && block.tool_use_id) {
      const tool = toolMap.get(block.tool_use_id);
      if (tool) {
        tool.status = block.is_error ? 'error' : 'completed';
        tool.endTime = timestamp;
      }

      const agent = agentMap.get(block.tool_use_id);
      if (agent) {
        agent.status = 'completed';
        agent.endTime = timestamp;
      }
    }
  }
}

function extractTarget(toolName: string, input?: Record<string, unknown>): string | undefined {
  if (!input) return undefined;

  switch (toolName) {
    case 'Read':
    case 'Write':
    case 'Edit':
      return (input.file_path as string) ?? (input.path as string);
    case 'Glob':
      return input.pattern as string;
    case 'Grep':
      return input.pattern as string;
    case 'Bash':
      const cmd = input.command as string;
      return cmd?.slice(0, 30) + (cmd?.length > 30 ? '...' : '');
  }
  return undefined;
}

function resolveTaskIndex(
  taskId: unknown,
  taskIdToIndex: Map<string, number>,
  latestTodos: TodoItem[]
): number | null {
  if (typeof taskId === 'string' || typeof taskId === 'number') {
    const key = String(taskId);
    const mapped = taskIdToIndex.get(key);
    if (typeof mapped === 'number') {
      return mapped;
    }

    if (/^\d+$/.test(key)) {
      const numericIndex = Number.parseInt(key, 10) - 1;
      if (numericIndex >= 0 && numericIndex < latestTodos.length) {
        return numericIndex;
      }
    }
  }

  return null;
}

function normalizeTaskStatus(status: unknown): TodoItem['status'] | null {
  if (typeof status !== 'string') return null;

  switch (status) {
    case 'pending':
    case 'not_started':
      return 'pending';
    case 'in_progress':
    case 'running':
      return 'in_progress';
    case 'completed':
    case 'complete':
    case 'done':
      return 'completed';
    default:
      return null;
  }
}
