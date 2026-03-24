import * as fs from 'fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'readline';
import { createHash } from 'node:crypto';
import { getHudPluginDir } from './claude-config-dir.js';
import type { TranscriptData, ToolEntry, AgentEntry, TodoItem, BashEntry } from './types.js';

interface TranscriptLine {
  timestamp?: string;
  type?: string;
  slug?: string;
  customTitle?: string;
  message?: {
    content?: ContentBlock[];
  };
}

interface ContentBlock {
  type: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  is_error?: boolean;
  content?: string | Array<{ type: string; text?: string }>;
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

interface SerializedBashEntry extends Omit<BashEntry, 'time' | 'endTime'> {
  time: string;
  endTime?: string;
}

interface SerializedTranscriptData {
  tools: SerializedToolEntry[];
  agents: SerializedAgentEntry[];
  todos: TodoItem[];
  recentBash?: SerializedBashEntry[];
  sessionStart?: string;
  sessionName?: string;
}

interface TranscriptCacheFile {
  transcriptPath: string;
  transcriptState: TranscriptFileState;
  data: SerializedTranscriptData;
}

let createReadStreamImpl: typeof fs.createReadStream = fs.createReadStream;

function getTranscriptCachePath(transcriptPath: string, homeDir: string): string {
  const hash = createHash('sha256').update(path.resolve(transcriptPath)).digest('hex');
  return path.join(getHudPluginDir(homeDir), 'transcript-cache', `${hash}.json`);
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
    recentBash: data.recentBash.map((bash) => ({
      ...bash,
      time: bash.time.toISOString(),
      endTime: bash.endTime?.toISOString(),
    })),
    sessionStart: data.sessionStart?.toISOString(),
    sessionName: data.sessionName,
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
    recentBash: (data.recentBash ?? []).map((bash) => ({
      ...bash,
      time: new Date(bash.time),
      endTime: bash.endTime ? new Date(bash.endTime) : undefined,
    })),
    sessionStart: data.sessionStart ? new Date(data.sessionStart) : undefined,
    sessionName: data.sessionName,
  };
}

function readTranscriptCache(transcriptPath: string, state: TranscriptFileState): TranscriptData | null {
  try {
    const cachePath = getTranscriptCachePath(transcriptPath, os.homedir());
    const raw = fs.readFileSync(cachePath, 'utf8');
    const parsed = JSON.parse(raw) as TranscriptCacheFile;
    if (
      parsed.transcriptPath !== path.resolve(transcriptPath)
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
      transcriptPath: path.resolve(transcriptPath),
      transcriptState: state,
      data: serializeTranscriptData(data),
    };
    fs.writeFileSync(cachePath, JSON.stringify(payload), 'utf8');
  } catch {
    // Cache failures are non-fatal; fall back to fresh parsing next time.
  }
}

export async function parseTranscript(transcriptPath: string): Promise<TranscriptData> {
  const result: TranscriptData = {
    tools: [],
    agents: [],
    todos: [],
    recentBash: [],
  };

  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    return result;
  }

  const transcriptState = readTranscriptFileState(transcriptPath);
  if (!transcriptState) {
    return result;
  }

  const cached = readTranscriptCache(transcriptPath, transcriptState);
  if (cached) {
    return cached;
  }

  const toolMap = new Map<string, ToolEntry>();
  const agentMap = new Map<string, AgentEntry>();
  const bashMap = new Map<string, BashEntry>();
  let latestTodos: TodoItem[] = [];
  const taskIdToIndex = new Map<string, number>();
  let latestSlug: string | undefined;
  let customTitle: string | undefined;

  let parsedCleanly = false;

  try {
    const fileStream = createReadStreamImpl(transcriptPath);
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
        processEntry(entry, toolMap, agentMap, bashMap, taskIdToIndex, latestTodos, result);
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
  result.recentBash = Array.from(bashMap.values()).slice(-5);
  result.todos = latestTodos;
  result.sessionName = customTitle ?? latestSlug;
  if (parsedCleanly) {
    writeTranscriptCache(transcriptPath, transcriptState, result);
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
  bashMap: Map<string, BashEntry>,
  taskIdToIndex: Map<string, number>,
  latestTodos: TodoItem[],
  result: TranscriptData
): void {
  const timestamp = entry.timestamp ? new Date(entry.timestamp) : new Date();

  if (!result.sessionStart && entry.timestamp) {
    result.sessionStart = timestamp;
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

      if (block.name === 'Bash') {
        const input = block.input as Record<string, unknown>;
        bashMap.set(block.id, {
          id: block.id,
          command: (input?.command as string) ?? '',
          description: (input?.description as string) ?? '',
          is_background: (input?.run_in_background as boolean) ?? false,
          output: '',
          is_error: false,
          interrupted: false,
          time: timestamp,
        });
      }

      if (block.name === 'Task') {
        const input = block.input as Record<string, unknown>;
        const agentEntry: AgentEntry = {
          id: block.id,
          type: (input?.subagent_type as string) ?? 'unknown',
          model: (input?.model as string) ?? undefined,
          description: (input?.description as string) ?? undefined,
          status: 'running',
          startTime: timestamp,
        };
        agentMap.set(block.id, agentEntry);
      } else if (block.name === 'TodoWrite') {
        const input = block.input as { todos?: TodoItem[] };
        if (input?.todos && Array.isArray(input.todos)) {
          latestTodos.length = 0;
          taskIdToIndex.clear();
          latestTodos.push(...input.todos);
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

      const bash = bashMap.get(block.tool_use_id);
      if (bash) {
        bash.is_error = !!block.is_error;
        bash.endTime = timestamp;
        const resultContent = block.content;
        if (typeof resultContent === 'string') {
          bash.output = resultContent;
        } else if (Array.isArray(resultContent)) {
          bash.output = resultContent
            .filter((c) => c.type === 'text')
            .map((c) => c.text ?? '')
            .join('\n');
        }
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
