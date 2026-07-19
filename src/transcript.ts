import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { createHash } from 'node:crypto';
import { getHudPluginDir } from './claude-config-dir.js';
import { createDebug } from './debug.js';
import type { TranscriptData, ToolEntry, AgentEntry, TodoItem, SessionTokenUsage } from './types.js';
import { sanitizeDisplayText } from './utils/sanitize.js';
import { sanitizeTranscriptModel } from './model-source.js';

const debug = createDebug('transcript');

interface TranscriptLine {
  timestamp?: string;
  type?: string;
  subtype?: string;
  operation?: string;
  content?: string;
  slug?: string;
  customTitle?: string;
  // Top-level field stamped onto every assistant record after `/advisor` is
  // set. Holds the canonical advisor model ID (e.g. "claude-opus-4-7").
  advisorModel?: string;
  message?: {
    id?: unknown;
    // Usually an array of content blocks, but slash-command records (e.g.
    // `/effort`) store their output as a raw string.
    content?: ContentBlock[] | string;
    model?: unknown;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  // Result payload the harness stamps onto the record carrying a tool_result
  // block. For Agent calls it reports `resolvedModel`, the model the subagent
  // actually runs on — the only source when the caller inherits the session
  // model instead of passing `model` explicitly.
  toolUseResult?: {
    resolvedModel?: unknown;
  };
  compactMetadata?: {
    trigger?: string;
    preTokens?: number;
    postTokens?: number;
    durationMs?: number;
  };
  // Harness state markers; `ultra_effort_enter` / `ultra_effort_exit` track
  // entering / leaving ultracode effort.
  attachment?: {
    type?: string;
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
  skills: string[];
  mcpServers: string[];
  agents: SerializedAgentEntry[];
  todos: TodoItem[];
  sessionStart?: string;
  sessionName?: string;
  lastAssistantResponseAt?: string;
  sessionTokens?: SessionTokenUsage;
  lastCompactBoundaryAt?: string;
  lastCompactPostTokens?: number;
  compactionCount?: number;
  advisorModel?: string;
  ultracodeActive?: boolean;
  lastAssistantModel?: string;
}

interface TranscriptCacheFile {
  version?: number;
  transcriptPath: string;
  transcriptState: TranscriptFileState;
  data: SerializedTranscriptData;
}

const TRANSCRIPT_CACHE_VERSION = 13;
const MCP_TOOL_NAME_PATTERN = /^mcp__(.+?)__(.+)$/;
const ACTIVITY_NAME_MAX_LEN = 64;
const MESSAGE_ID_MAX_LEN = 128;
const SEEN_MESSAGE_IDS_MAX = 4096;

// Hard cap on the advisor model ID captured from the transcript. Real Claude
// model IDs (e.g. "claude-haiku-4-5-20251001") fit comfortably under this; the
// cap exists to prevent a malformed transcript from persisting an oversized
// string through the JSON cache and onto every statusline refresh.
const ADVISOR_MODEL_MAX_LEN = 64;

let createReadStreamImpl: typeof fs.createReadStream = fs.createReadStream;

function normalizeTokenCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.trunc(value));
}

function normalizeMessageId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= MESSAGE_ID_MAX_LEN
    ? value
    : null;
}

function rememberMessageId(seenMessageIds: Set<string>, messageId: string): void {
  if (seenMessageIds.size >= SEEN_MESSAGE_IDS_MAX) {
    const oldest = seenMessageIds.values().next().value;
    if (oldest !== undefined) {
      seenMessageIds.delete(oldest);
    }
  }
  seenMessageIds.add(messageId);
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

function normalizeNameList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const names: string[] = [];
  for (const item of value) {
    const name = normalizeActivityName(item);
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    names.push(name);
  }

  return names;
}

function normalizeActivityName(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const sanitized = sanitizeDisplayText(value).trim();

  if (!sanitized) {
    return undefined;
  }

  if (sanitized.length <= ACTIVITY_NAME_MAX_LEN) {
    return sanitized;
  }

  return `${sanitized.slice(0, ACTIVITY_NAME_MAX_LEN - 1)}…`;
}

function getTranscriptCachePath(transcriptPath: string, homeDir: string): string {
  const hash = createHash('sha256').update(path.resolve(transcriptPath)).digest('hex');
  return path.join(getHudPluginDir(homeDir), 'transcript-cache', `${hash}.json`);
}

function canonicalizeTranscriptPath(transcriptPath: string): string | null {
  try {
    return fs.realpathSync(transcriptPath);
  } catch (err) {
    debug('Failed to resolve transcript path %s:', transcriptPath, err instanceof Error ? err.message : err);
    return null;
  }
}

function readTranscriptFileState(transcriptPath: string): TranscriptFileState | null {
  try {
    const stat = fs.statSync(transcriptPath);
    if (!stat.isFile()) {
      debug('Transcript path is not a file: %s', transcriptPath);
      return null;
    }
    return {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
    };
  } catch (err) {
    debug('Failed to stat transcript file %s:', transcriptPath, err instanceof Error ? err.message : err);
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
    skills: [...data.skills],
    mcpServers: [...data.mcpServers],
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
    compactionCount: data.compactionCount,
    advisorModel: data.advisorModel,
    ultracodeActive: data.ultracodeActive,
    lastAssistantModel: sanitizeTranscriptModel(data.lastAssistantModel),
  };
}

function deserializeTranscriptData(data: SerializedTranscriptData): TranscriptData {
  return {
    tools: data.tools.map((tool) => ({
      ...tool,
      startTime: new Date(tool.startTime),
      endTime: tool.endTime ? new Date(tool.endTime) : undefined,
    })),
    skills: normalizeNameList(data.skills),
    mcpServers: normalizeNameList(data.mcpServers),
    agents: data.agents.map((agent) => ({
      ...agent,
      model: sanitizeTranscriptModel(agent.model),
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
    compactionCount: typeof data.compactionCount === 'number' && Number.isFinite(data.compactionCount) && data.compactionCount >= 0
      ? Math.trunc(data.compactionCount)
      : undefined,
    advisorModel: typeof data.advisorModel === 'string' && data.advisorModel.length > 0
      ? data.advisorModel.slice(0, ADVISOR_MODEL_MAX_LEN)
      : undefined,
    ultracodeActive: typeof data.ultracodeActive === 'boolean' ? data.ultracodeActive : undefined,
    lastAssistantModel: sanitizeTranscriptModel(data.lastAssistantModel),
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
  } catch (err) {
    debug('Failed to read transcript cache:', err instanceof Error ? err.message : err);
    return null;
  }
}

function writeTranscriptCache(transcriptPath: string, state: TranscriptFileState, data: TranscriptData): void {
  try {
    const cachePath = getTranscriptCachePath(transcriptPath, os.homedir());
    const cacheDir = path.dirname(cachePath);
    fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
    try {
      fs.chmodSync(cacheDir, 0o700);
    } catch {
      // Best-effort: some filesystems do not support POSIX modes.
    }
    const payload: TranscriptCacheFile = {
      version: TRANSCRIPT_CACHE_VERSION,
      transcriptPath: path.resolve(transcriptPath),
      transcriptState: state,
      data: serializeTranscriptData(data),
    };
    fs.writeFileSync(cachePath, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 });
    try {
      fs.chmodSync(cachePath, 0o600);
    } catch {
      // Best-effort: cache permissions should not break rendering.
    }
  } catch (err) {
    debug('Failed to write transcript cache:', err instanceof Error ? err.message : err);
  }
}

export async function parseTranscript(transcriptPath: string): Promise<TranscriptData> {
  const result: TranscriptData = {
    tools: [],
    skills: [],
    mcpServers: [],
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
  const skillSet = new Set<string>();
  const mcpServerSet = new Set<string>();
  const agentMap = new Map<string, AgentEntry>();
  let latestTodos: TodoItem[] = [];
  const taskIdToIndex = new Map<string, number>();
  const queueCompletionMap = new Map<string, Date>();
  let latestSlug: string | undefined;
  let customTitle: string | undefined;
  let latestAdvisorModel: string | undefined;
  let latestUltracodeActive: boolean | undefined;
  let lastCompactBoundaryAt: Date | undefined;
  let lastCompactPostTokens: number | undefined;
  let compactionCount = 0;
  const sessionTokens: SessionTokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
  };
  const seenMessageIds = new Set<string>();
  let lastUsageKey: string | undefined;

  let parsedCleanly = false;

  try {
    const fileStream = createReadStreamImpl(canonicalTranscriptPath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) {
        lastUsageKey = undefined;
        continue;
      }

      try {
        const entry = JSON.parse(line) as TranscriptLine;
        if (entry.type === 'custom-title' && typeof entry.customTitle === 'string') {
          customTitle = entry.customTitle;
        } else if (typeof entry.slug === 'string') {
          latestSlug = entry.slug;
        }
        // Capture the advisor model from the top-level `advisorModel` field.
        // Claude Code stamps this onto every *assistant* record after `/advisor`
        // is set, so we restrict to that record type (matching the documented
        // source) and the most recent occurrence reflects the current choice.
        // Length is hard-capped so a malformed transcript cannot persist an
        // unbounded value through the cache layer.
        if (
          entry.type === 'assistant'
          && typeof entry.advisorModel === 'string'
          && entry.advisorModel.length > 0
        ) {
          latestAdvisorModel = entry.advisorModel.slice(0, ADVISOR_MODEL_MAX_LEN);
        }
        // Current ultracode state, distinguishable only from the transcript
        // (stdin reports it as plain `xhigh`). Two signals update this in file
        // order, last wins: the self-correcting ultra_effort_enter/exit
        // attachment (can lag a turn) and the immediate `/effort` command output.
        if (entry.type === 'attachment') {
          const attachmentType = entry.attachment?.type;
          if (attachmentType === 'ultra_effort_enter') {
            latestUltracodeActive = true;
          } else if (attachmentType === 'ultra_effort_exit') {
            latestUltracodeActive = false;
          }
        }
        // The `/effort` command-output signal. Anchored at the start of a *user*
        // record's string content, so prose quoting the phrase can't flip state.
        // Brittle by necessity — couples to Claude Code's /effort wording; if that
        // changes, the label falls back to the (laggier) attachments.
        if (entry.type === 'user' && typeof entry.message?.content === 'string') {
          const effortCommandMatch = entry.message.content.match(
            /^<local-command-stdout>Set effort level to (\w+)/,
          );
          if (effortCommandMatch) {
            latestUltracodeActive = effortCommandMatch[1].toLowerCase() === 'ultracode';
          }
        }
        // Capture the actual model from the assistant message's `model` field.
        // This reflects what the API actually served, which may differ from the
        // model Claude Code thinks it's using (e.g. proxy redirect via cc-switch).
        if (entry.type === 'assistant') {
          const transcriptModel = sanitizeTranscriptModel(entry.message?.model);
          if (transcriptModel) {
            result.lastAssistantModel = transcriptModel;
          }
        }
        // Accumulate token usage from assistant messages.
        // Claude Code can write the same API response to the transcript 2-3 times
        // (dual-logging). Prefer the API-response-level message.id so duplicates
        // can be removed even when another record appears between them. Only
        // bounded string IDs are retained, and the set is capped to keep a
        // malformed transcript from growing memory without limit. Records with
        // missing or invalid IDs keep the previous consecutive usage-fingerprint
        // fallback.
        if (entry.type === 'assistant' && entry.message?.usage) {
          const usage = entry.message.usage;
          const msgId = normalizeMessageId(entry.message.id);
          let shouldCount = false;

          if (msgId !== null) {
            lastUsageKey = undefined;
            if (!seenMessageIds.has(msgId)) {
              rememberMessageId(seenMessageIds, msgId);
              shouldCount = true;
            }
          } else {
            const usageKey = `${usage.input_tokens}|${usage.output_tokens}|${usage.cache_creation_input_tokens}|${usage.cache_read_input_tokens}`;
            shouldCount = usageKey !== lastUsageKey;
            lastUsageKey = usageKey;
          }

          if (shouldCount) {
            sessionTokens.inputTokens += normalizeTokenCount(usage.input_tokens);
            sessionTokens.outputTokens += normalizeTokenCount(usage.output_tokens);
            sessionTokens.cacheCreationTokens += normalizeTokenCount(usage.cache_creation_input_tokens);
            sessionTokens.cacheReadTokens += normalizeTokenCount(usage.cache_read_input_tokens);
          }
        } else {
          lastUsageKey = undefined;
        }
        // Track Claude Code's compact_boundary marker. Both manual (/compact)
        // and auto compaction emit this system entry with compactMetadata; we
        // take the most recent one's timestamp so callers can distinguish a
        // legitimate post-compact zero frame from a transient stdin glitch.
        if (entry.type === 'system' && entry.subtype === 'compact_boundary') {
          const ts = entry.timestamp ? new Date(entry.timestamp) : null;
          if (ts && !Number.isNaN(ts.getTime())) {
            compactionCount += 1;
            if (!lastCompactBoundaryAt || ts.getTime() > lastCompactBoundaryAt.getTime()) {
              lastCompactBoundaryAt = ts;
              const post = entry.compactMetadata?.postTokens;
              lastCompactPostTokens = typeof post === 'number' && Number.isFinite(post) && post >= 0
                ? Math.trunc(post)
                : undefined;
            }
          }
        }
        // Capture accurate background-agent completion timestamps from queue-operation entries.
        // The tool_result timestamp in the parent transcript is written at launch time, not
        // when the agent actually finishes, so we override with the enqueue timestamp.
        if (entry.type === 'queue-operation' && entry.operation === 'enqueue' && entry.content) {
          const taskIdMatch = entry.content.match(/<task-id>([^<]+)<\/task-id>/);
          const toolUseIdMatch = entry.content.match(/<tool-use-id>([^<]+)<\/tool-use-id>/);
          if (taskIdMatch && toolUseIdMatch && entry.timestamp) {
            const ts = new Date(entry.timestamp);
            if (!Number.isNaN(ts.getTime())) {
              queueCompletionMap.set(toolUseIdMatch[1], ts);
            }
          }
        }
        processEntry(entry, toolMap, skillSet, mcpServerSet, agentMap, taskIdToIndex, latestTodos, result);
      } catch (err) {
        lastUsageKey = undefined;
        debug('Skipping malformed transcript line:', err instanceof Error ? err.message : err);
      }
    }

    parsedCleanly = true;
  } catch (err) {
    debug('Transcript stream read error, returning partial results:', err instanceof Error ? err.message : err);
  }

  // Resolve agent completion: prefer queue-operation timestamps (accurate for
  // background agents), fall back to tool_result timestamps (inline agents).
  // Status is deferred so background agents show ◐ until they truly finish.
  for (const [toolUseId, endTime] of queueCompletionMap) {
    const agent = agentMap.get(toolUseId);
    if (agent?.background) {
      agent.endTime = endTime;
      agent.status = 'completed';
    }
  }
  for (const agent of agentMap.values()) {
    if (agent.status === 'running' && agent.endTime) {
      agent.status = 'completed';
    }
  }
  result.tools = Array.from(toolMap.values()).slice(-20);
  result.skills = Array.from(skillSet.values());
  result.mcpServers = Array.from(mcpServerSet.values());
  result.agents = Array.from(agentMap.values()).slice(-10);
  result.todos = latestTodos;
  result.sessionName = customTitle ?? latestSlug;
  result.sessionTokens = sessionTokens;
  result.lastCompactBoundaryAt = lastCompactBoundaryAt;
  result.lastCompactPostTokens = lastCompactPostTokens;
  result.compactionCount = compactionCount;
  result.advisorModel = latestAdvisorModel;
  result.ultracodeActive = latestUltracodeActive;
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
  skillSet: Set<string>,
  mcpServerSet: Set<string>,
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
      const skillName = block.name === 'Skill'
        ? normalizeSkillName(block.input?.skill)
        : undefined;
      if (skillName) {
        skillSet.add(skillName);
      }

      const mcpServerName = extractMcpServerName(block.name);
      if (mcpServerName) {
        mcpServerSet.add(mcpServerName);
      }

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
          model: sanitizeTranscriptModel(input?.model),
          description: (input?.description as string) ?? undefined,
          status: 'running',
          startTime: timestamp,
          background: (input?.run_in_background as boolean) === true,
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
        // `resolvedModel` is the model the subagent actually ran on, so it wins
        // over the caller's `model` input (an alias like "opus", and absent
        // entirely whenever the subagent inherits the session model).
        const resolvedModel = sanitizeTranscriptModel(entry.toolUseResult?.resolvedModel);
        if (resolvedModel) {
          agent.model = resolvedModel;
        }
        if (!agent.background) {
          agent.endTime = timestamp;
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
    case 'Skill':
      return normalizeSkillName(input.skill);
    case 'Bash':
      if (typeof input.command !== 'string') {
        return undefined;
      }
      const cmd = input.command.replace(/\s+/g, ' ').trim();
      return cmd
        ? cmd.length > 30
          ? `${cmd.slice(0, 30).trimEnd()}...`
          : cmd
        : undefined;
  }
  return undefined;
}

function normalizeSkillName(value: unknown): string | undefined {
  return normalizeActivityName(value);
}

function extractMcpServerName(toolName: string): string | undefined {
  const match = MCP_TOOL_NAME_PATTERN.exec(toolName);
  if (!match) {
    return undefined;
  }

  return normalizeActivityName(match[1]);
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
