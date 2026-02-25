import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';
import type { AgentEntry, TodoItem, ToolEntry, TranscriptData } from './types.js';

interface TranscriptLine {
  timestamp?: string;
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
}

// Serialized versions with ISO strings instead of Date objects
interface SerializedToolEntry {
  id: string;
  name: string;
  target?: string;
  status: 'running' | 'completed' | 'error';
  startTime: string;
  endTime?: string;
}

interface SerializedAgentEntry {
  id: string;
  type: string;
  model?: string;
  description?: string;
  status: 'running' | 'completed';
  startTime: string;
  endTime?: string;
}

interface TranscriptCache {
  transcriptPath: string;
  byteOffset: number;
  sessionStart?: string;
  toolMap: [string, SerializedToolEntry][];
  agentMap: [string, SerializedAgentEntry][];
  taskIdToIndex: [string, number][];
  latestTodos: TodoItem[];
}

export type TranscriptDeps = {
  homeDir: () => string;
};

const defaultDeps: TranscriptDeps = {
  homeDir: () => os.homedir(),
};

function getCachePath(homeDir: string): string {
  return path.join(homeDir, '.claude', 'plugins', 'claude-hud', '.transcript-cache.json');
}

function readCache(homeDir: string): TranscriptCache | null {
  try {
    const cachePath = getCachePath(homeDir);
    if (!fs.existsSync(cachePath)) return null;
    const content = fs.readFileSync(cachePath, 'utf8');
    return JSON.parse(content) as TranscriptCache;
  } catch {
    return null;
  }
}

function writeCache(homeDir: string, cache: TranscriptCache): void {
  try {
    const cachePath = getCachePath(homeDir);
    const cacheDir = path.dirname(cachePath);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    fs.writeFileSync(cachePath, JSON.stringify(cache), 'utf8');
  } catch {
    // Ignore cache write failures
  }
}

function serializeToolEntry(entry: ToolEntry): SerializedToolEntry {
  return {
    id: entry.id,
    name: entry.name,
    target: entry.target,
    status: entry.status,
    startTime: entry.startTime.toISOString(),
    endTime: entry.endTime?.toISOString(),
  };
}

function deserializeToolEntry(entry: SerializedToolEntry): ToolEntry {
  return {
    id: entry.id,
    name: entry.name,
    target: entry.target,
    status: entry.status,
    startTime: new Date(entry.startTime),
    endTime: entry.endTime ? new Date(entry.endTime) : undefined,
  };
}

function serializeAgentEntry(entry: AgentEntry): SerializedAgentEntry {
  return {
    id: entry.id,
    type: entry.type,
    model: entry.model,
    description: entry.description,
    status: entry.status,
    startTime: entry.startTime.toISOString(),
    endTime: entry.endTime?.toISOString(),
  };
}

function deserializeAgentEntry(entry: SerializedAgentEntry): AgentEntry {
  return {
    id: entry.id,
    type: entry.type,
    model: entry.model,
    description: entry.description,
    status: entry.status,
    startTime: new Date(entry.startTime),
    endTime: entry.endTime ? new Date(entry.endTime) : undefined,
  };
}

export async function parseTranscript(
  transcriptPath: string,
  overrides: Partial<TranscriptDeps> = {},
): Promise<TranscriptData> {
  const deps = { ...defaultDeps, ...overrides };
  const homeDir = deps.homeDir();

  const result: TranscriptData = {
    tools: [],
    agents: [],
    todos: [],
  };

  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    return result;
  }

  // Check file size
  let fileSize: number;
  try {
    const stat = fs.statSync(transcriptPath);
    fileSize = stat.size;
  } catch {
    return result;
  }

  // Try to use cached state for incremental parsing
  const cached = readCache(homeDir);
  const canIncrement = cached !== null
    && cached.transcriptPath === transcriptPath
    && cached.byteOffset > 0
    && cached.byteOffset <= fileSize;

  // Restore or initialize state
  const toolMap = new Map<string, ToolEntry>();
  const agentMap = new Map<string, AgentEntry>();
  let latestTodos: TodoItem[] = [];
  const taskIdToIndex = new Map<string, number>();

  if (canIncrement) {
    // Restore cached state
    for (const [key, value] of cached.toolMap) {
      toolMap.set(key, deserializeToolEntry(value));
    }
    for (const [key, value] of cached.agentMap) {
      agentMap.set(key, deserializeAgentEntry(value));
    }
    latestTodos = [...cached.latestTodos];
    for (const [key, value] of cached.taskIdToIndex) {
      taskIdToIndex.set(key, value);
    }
    if (cached.sessionStart) {
      result.sessionStart = new Date(cached.sessionStart);
    }
  }

  // If file size unchanged and we have cache, return cached result directly
  if (canIncrement && cached.byteOffset === fileSize) {
    result.tools = Array.from(toolMap.values()).slice(-20);
    result.agents = Array.from(agentMap.values()).slice(-10);
    result.todos = latestTodos;
    return result;
  }

  // Parse from byte offset (or beginning for full parse)
  const startOffset = canIncrement ? cached.byteOffset : 0;

  try {
    const fileStream = fs.createReadStream(transcriptPath, {
      start: startOffset,
      encoding: 'utf8',
    });
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    let isFirstLine = startOffset > 0;
    for await (const line of rl) {
      // First line after byte-offset seek may be a partial line — skip it
      if (isFirstLine) {
        isFirstLine = false;
        // Only skip if it fails to parse (partial line)
        if (line.trim()) {
          try {
            const entry = JSON.parse(line) as TranscriptLine;
            processEntry(entry, toolMap, agentMap, taskIdToIndex, latestTodos, result);
          } catch {
            // Partial line from mid-byte seek, skip
          }
        }
        continue;
      }

      if (!line.trim()) continue;

      try {
        const entry = JSON.parse(line) as TranscriptLine;
        processEntry(entry, toolMap, agentMap, taskIdToIndex, latestTodos, result);
      } catch {
        // Skip malformed lines
      }
    }
  } catch {
    // Return partial results on error
  }

  result.tools = Array.from(toolMap.values()).slice(-20);
  result.agents = Array.from(agentMap.values()).slice(-10);
  result.todos = latestTodos;

  // Write cache for next invocation
  const newCache: TranscriptCache = {
    transcriptPath,
    byteOffset: fileSize,
    sessionStart: result.sessionStart?.toISOString(),
    toolMap: Array.from(toolMap.entries()).map(([k, v]) => [k, serializeToolEntry(v)]),
    agentMap: Array.from(agentMap.entries()).map(([k, v]) => [k, serializeAgentEntry(v)]),
    taskIdToIndex: Array.from(taskIdToIndex.entries()),
    latestTodos,
  };
  writeCache(homeDir, newCache);

  return result;
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
