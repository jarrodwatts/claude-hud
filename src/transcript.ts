import * as fs from 'fs';
import * as readline from 'readline';
import type { TranscriptData, ToolEntry, AgentEntry, TodoItem } from './types.js';
import { readCache, writeCache, getDefaultCacheDir } from './cache.js';

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
}

interface TranscriptCacheEntry {
  data: TranscriptData;
  offset: number;
}

function restoreDates(data: TranscriptData): TranscriptData {
  return {
    ...data,
    sessionStart: data.sessionStart ? new Date(data.sessionStart) : undefined,
    tools: data.tools.map(t => ({
      ...t,
      startTime: new Date(t.startTime),
      endTime: t.endTime ? new Date(t.endTime) : undefined,
    })),
    agents: data.agents.map(a => ({
      ...a,
      startTime: new Date(a.startTime),
      endTime: a.endTime ? new Date(a.endTime) : undefined,
    })),
    todos: data.todos,
  };
}

function mergeNewLines(existing: TranscriptData, newLines: string[]): TranscriptData {
  // Rebuild maps from existing data so we can update in-place
  const toolMap = new Map<string, ToolEntry>(existing.tools.map(t => [t.id, t]));
  const agentMap = new Map<string, AgentEntry>(existing.agents.map(a => [a.id, a]));
  const latestTodos: TodoItem[] = [...existing.todos];
  const taskIdToIndex = new Map<string, number>();

  // Re-index existing todos by position
  latestTodos.forEach((_, i) => taskIdToIndex.set(String(i + 1), i));

  const merged: TranscriptData = {
    tools: existing.tools,
    agents: existing.agents,
    todos: latestTodos,
    sessionStart: existing.sessionStart,
    sessionName: existing.sessionName,
  };

  for (const line of newLines) {
    try {
      const entry = JSON.parse(line) as TranscriptLine;
      if (entry.type === 'custom-title' && typeof entry.customTitle === 'string') {
        merged.sessionName = entry.customTitle;
      } else if (typeof entry.slug === 'string') {
        merged.sessionName = merged.sessionName ?? entry.slug;
      }
      processEntry(entry, toolMap, agentMap, taskIdToIndex, latestTodos, merged);
    } catch {
      // Skip malformed lines
    }
  }

  merged.tools = Array.from(toolMap.values()).slice(-20);
  merged.agents = Array.from(agentMap.values()).slice(-10);
  merged.todos = latestTodos;

  return merged;
}

export async function parseTranscript(transcriptPath: string): Promise<TranscriptData> {
  const result: TranscriptData = {
    tools: [],
    agents: [],
    todos: [],
  };

  if (!transcriptPath) {
    return result;
  }

  const cacheDir = getDefaultCacheDir();
  const stats = fs.statSync(transcriptPath, { throwIfNoEntry: false });
  if (!stats) return result;

  const mtime = stats.mtimeMs;
  const cacheKey = 'transcript-full';

  // Check mtime cache — if hit, return cached data unchanged
  const cachedEntry = readCache<TranscriptCacheEntry>(cacheKey, 86400000, cacheDir, mtime);
  if (cachedEntry) {
    return restoreDates(cachedEntry.data);
  }

  if (!fs.existsSync(transcriptPath)) {
    return result;
  }

  // mtime changed — check if we have a previous parse with byte offset
  const prevEntry = readCache<TranscriptCacheEntry>(cacheKey, 86400000, cacheDir);
  if (prevEntry && prevEntry.offset <= stats.size) {
    const newByteCount = stats.size - prevEntry.offset;

    if (newByteCount > 0) {
      // Incremental: read only new bytes from offset
      const fd = fs.openSync(transcriptPath, 'r');
      const newBytes = Buffer.alloc(newByteCount);
      fs.readSync(fd, newBytes, 0, newByteCount, prevEntry.offset);
      fs.closeSync(fd);

      const newContent = newBytes.toString('utf-8');
      const newLines = newContent.split('\n').filter(l => l.trim());

      if (newLines.length > 0) {
        const merged = mergeNewLines(prevEntry.data, newLines);
        const entry: TranscriptCacheEntry = { data: merged, offset: stats.size };
        writeCache(cacheKey, entry, cacheDir, mtime);
        return restoreDates(merged);
      }
    }

    // No new content (or empty new lines)
    const entry: TranscriptCacheEntry = { data: prevEntry.data, offset: stats.size };
    writeCache(cacheKey, entry, cacheDir, mtime);
    return restoreDates(prevEntry.data);
  }

  // Full parse fallback (no previous offset or file was truncated)
  const toolMap = new Map<string, ToolEntry>();
  const agentMap = new Map<string, AgentEntry>();
  let latestTodos: TodoItem[] = [];
  const taskIdToIndex = new Map<string, number>();
  let latestSlug: string | undefined;
  let customTitle: string | undefined;

  try {
    const fileStream = fs.createReadStream(transcriptPath);
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
  result.sessionName = customTitle ?? latestSlug;

  const fullEntry: TranscriptCacheEntry = { data: result, offset: stats.size };
  writeCache(cacheKey, fullEntry, cacheDir, mtime);
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
