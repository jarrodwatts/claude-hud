import * as fs from 'node:fs';
import * as readline from 'node:readline';
import { createDebug } from './debug.js';
import type { AgentEntry, SessionTokenUsage, TodoItem, ToolEntry, TranscriptData } from './types.js';
import { sanitizeDisplayText } from './utils/sanitize.js';
import { sanitizeTranscriptModel } from './model-source.js';

const debug = createDebug('transcript');

const TOOLS_KEPT = 20;
const AGENTS_KEPT = 10;
const NAME_MAX_LEN = 64;
const ADVISOR_MODEL_MAX_LEN = 64;
const MESSAGE_ID_MAX_LEN = 128;
const MESSAGE_IDS_MAX = 4096;
const MCP_ERRORS_MAX = 64;
const MCP_TOOL = /^mcp__(.+?)__(.+)$/;
// Claude Code's /effort output; anchored so prose quoting it can't flip ultracode.
const EFFORT_COMMAND = /^<local-command-stdout>Set effort level to (\w+)/;

interface Usage {
  input_tokens?: unknown;
  output_tokens?: unknown;
  cache_creation_input_tokens?: unknown;
  cache_read_input_tokens?: unknown;
}

interface Block {
  type?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  is_error?: boolean;
}

interface Entry {
  type?: string;
  subtype?: string;
  operation?: string;
  content?: unknown;
  timestamp?: string;
  isSidechain?: boolean;
  advisorModel?: unknown;
  message?: { id?: unknown; model?: unknown; content?: Block[] | string; usage?: Usage };
  toolUseResult?: { resolvedModel?: unknown; isAsync?: unknown; status?: unknown };
  compactMetadata?: { postTokens?: unknown };
  attachment?: { type?: string };
}

const emptyTranscript = (): TranscriptData => ({ tools: [], skills: [], mcpServers: [], mcpErrors: [], agents: [], todos: [] });

const ZERO_USAGE: SessionTokenUsage = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
const USAGE_FIELDS = Object.keys(ZERO_USAGE) as (keyof SessionTokenUsage)[];

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;

function addUsage(total: SessionTokenUsage, usage: SessionTokenUsage): void {
  for (const field of USAGE_FIELDS) total[field] += usage[field];
}

function name(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = sanitizeDisplayText(value).trim();
  if (!text) return undefined;
  return text.length <= NAME_MAX_LEN ? text : `${text.slice(0, NAME_MAX_LEN - 1)}…`;
}

const mcpServer = (toolName: string): string | undefined => name(MCP_TOOL.exec(toolName)?.[1]);

// Tool inputs are written by the model, so their text is untrusted terminal input.
const text = (value: unknown): string | undefined =>
  typeof value === 'string' ? sanitizeDisplayText(value) || undefined : undefined;

function toolTarget(toolName: string, input: Record<string, unknown> | undefined): string | undefined {
  if (!input) return undefined;
  switch (toolName) {
    case 'Read':
    case 'Write':
    case 'Edit':
      return text(input.file_path ?? input.path);
    case 'Glob':
    case 'Grep':
      return text(input.pattern);
    case 'Skill':
      return name(input.skill);
    case 'Bash': {
      const command = text(input.command)?.replace(/\s+/g, ' ').trim();
      if (!command) return undefined;
      return command.length > 30 ? `${command.slice(0, 30).trimEnd()}...` : command;
    }
  }
  return undefined;
}

function taskStatus(status: unknown): TodoItem['status'] | null {
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

function toTodo(value: unknown): TodoItem[] {
  const todo = value as { content?: unknown; status?: unknown } | null;
  const content = text(todo?.content);
  const status = taskStatus(todo?.status);
  return content && status ? [{ content, status }] : [];
}

class Parser {
  private tools = new Map<string, ToolEntry>();
  private agents = new Map<string, AgentEntry>();
  private skills = new Set<string>();
  private mcpServers = new Set<string>();
  private mcpErrors = new Set<string>();
  private todos: TodoItem[] = [];
  private taskIndex = new Map<string, number>();
  private agentCompletions = new Map<string, Date>();
  // Claude Code logs one API response several times, sometimes non-adjacently, so usage
  // is the per-field max per message id. Ids evicted to bound memory settle into `settled`.
  private usageById = new Map<string, SessionTokenUsage>();
  private settled: SessionTokenUsage = { ...ZERO_USAGE };
  private lastIdlessUsage: string | undefined;
  private data: TranscriptData = { ...emptyTranscript(), compactionCount: 0 };

  line(raw: string): void {
    let entry: Entry | null = null;
    try {
      entry = raw.trim() ? JSON.parse(raw) : null;
    } catch {
      // Malformed lines are skipped.
    }
    if (!entry || typeof entry !== 'object') {
      this.lastIdlessUsage = undefined;
      return;
    }

    const time = entry.timestamp ? new Date(entry.timestamp) : null;
    const at = time && !Number.isNaN(time.getTime()) ? time : null;
    if (at && !this.data.sessionStart) this.data.sessionStart = at;

    if (entry.type === 'assistant') {
      this.assistant(entry, at);
    } else {
      this.lastIdlessUsage = undefined;
    }
    if (entry.type === 'user' && typeof entry.message?.content === 'string') {
      const effort = EFFORT_COMMAND.exec(entry.message.content);
      if (effort) this.data.ultracodeActive = effort[1].toLowerCase() === 'ultracode';
    }
    if (entry.type === 'attachment') {
      if (entry.attachment?.type === 'ultra_effort_enter') this.data.ultracodeActive = true;
      if (entry.attachment?.type === 'ultra_effort_exit') this.data.ultracodeActive = false;
    }
    if (entry.type === 'system' && entry.subtype === 'compact_boundary' && at) {
      this.data.compactionCount = (this.data.compactionCount ?? 0) + 1;
      const post = entry.compactMetadata?.postTokens;
      this.data.contextTokens = typeof post === 'number' && Number.isFinite(post) && post >= 0 ? Math.trunc(post) : undefined;
    }
    // A background agent's tool_result lands at launch; its completion is this enqueue.
    if (entry.type === 'queue-operation' && entry.operation === 'enqueue' && typeof entry.content === 'string' && at) {
      const toolUseId = /<tool-use-id>([^<]+)<\/tool-use-id>/.exec(entry.content)?.[1];
      if (toolUseId && /<task-id>[^<]+<\/task-id>/.test(entry.content)) this.agentCompletions.set(toolUseId, at);
    }

    if (Array.isArray(entry.message?.content)) {
      for (const block of entry.message.content) {
        if (block?.type === 'tool_use' && block.id && block.name) this.toolUse(block, at ?? new Date());
        if (block?.type === 'tool_result' && block.tool_use_id) this.toolResult(block, entry, at ?? new Date());
      }
    }
  }

  private assistant(entry: Entry, at: Date | null): void {
    if (at) this.data.lastAssistantResponseAt = at;
    if (typeof entry.advisorModel === 'string' && entry.advisorModel) {
      this.data.advisorModel = entry.advisorModel.slice(0, ADVISOR_MODEL_MAX_LEN);
    }
    const model = sanitizeTranscriptModel(entry.message?.model);
    // Claude Code writes '<synthetic>' on assistant records it generates locally.
    if (model && model !== '<synthetic>') this.data.lastAssistantModel = model;

    const raw = entry.message?.usage;
    if (!raw) {
      this.lastIdlessUsage = undefined;
      return;
    }
    const usage: SessionTokenUsage = {
      inputTokens: count(raw.input_tokens),
      outputTokens: count(raw.output_tokens),
      cacheCreationTokens: count(raw.cache_creation_input_tokens),
      cacheReadTokens: count(raw.cache_read_input_tokens),
    };
    if (entry.isSidechain !== true) {
      this.data.contextTokens = usage.inputTokens + usage.cacheCreationTokens + usage.cacheReadTokens;
    }

    const id = entry.message?.id;
    if (typeof id === 'string' && id && id.length <= MESSAGE_ID_MAX_LEN) {
      this.lastIdlessUsage = undefined;
      const previous = this.usageById.get(id);
      this.usageById.set(id, previous ? maxUsage(previous, usage) : usage);
      if (this.usageById.size > MESSAGE_IDS_MAX) {
        const [oldestId, oldest] = this.usageById.entries().next().value as [string, SessionTokenUsage];
        this.usageById.delete(oldestId);
        addUsage(this.settled, oldest);
      }
      return;
    }
    // Without an id, only an identical record right after the previous one is a duplicate.
    const fingerprint = JSON.stringify(usage);
    if (fingerprint !== this.lastIdlessUsage) addUsage(this.settled, usage);
    this.lastIdlessUsage = fingerprint;
  }

  private toolUse(block: Block, at: Date): void {
    const toolName = block.name as string;
    const input = block.input;
    const skill = toolName === 'Skill' ? name(input?.skill) : undefined;
    if (skill) this.skills.add(skill);
    const server = mcpServer(toolName);
    if (server) this.mcpServers.add(server);

    if (toolName === 'Task' || toolName === 'Agent') {
      this.agents.set(block.id as string, {
        id: block.id as string,
        type: (input?.subagent_type as string) ?? 'agent',
        model: sanitizeTranscriptModel(input?.model),
        description: (input?.description as string) ?? undefined,
        status: 'running',
        startTime: at,
        background: input?.run_in_background === true,
      });
    } else if (toolName === 'TodoWrite') {
      if (Array.isArray(input?.todos)) this.replaceTodos(input.todos.flatMap(toTodo));
    } else if (toolName === 'TaskCreate') {
      const content = text(input?.subject) ?? text(input?.description);
      this.todos.push({ content: content ?? 'Untitled task', status: taskStatus(input?.status) ?? 'pending' });
      const taskId = typeof input?.taskId === 'string' || typeof input?.taskId === 'number' ? String(input.taskId) : block.id;
      if (taskId) this.taskIndex.set(taskId, this.todos.length - 1);
    } else if (toolName === 'TaskUpdate') {
      const todo = this.todos[this.findTask(input?.taskId) ?? -1];
      if (!todo) return;
      const status = taskStatus(input?.status);
      if (status) todo.status = status;
      const content = text(input?.subject) ?? text(input?.description);
      if (content) todo.content = content;
    } else {
      this.tools.set(block.id as string, {
        id: block.id as string,
        name: toolName,
        target: toolTarget(toolName, input),
        status: 'running',
        startTime: at,
      });
    }
  }

  private toolResult(block: Block, entry: Entry, at: Date): void {
    const id = block.tool_use_id as string;
    const tool = this.tools.get(id);
    if (tool) {
      tool.status = block.is_error ? 'error' : 'completed';
      tool.endTime = at;
      const server = mcpServer(tool.name);
      if (server && block.is_error) {
        this.mcpErrors.add(server);
        if (this.mcpErrors.size > MCP_ERRORS_MAX) this.mcpErrors.delete(this.mcpErrors.values().next().value as string);
      } else if (server) {
        this.mcpErrors.delete(server);
      }
    }

    const agent = this.agents.get(id);
    if (agent) {
      // resolvedModel is what the subagent actually ran on, so it beats the caller's alias.
      agent.model = sanitizeTranscriptModel(entry.toolUseResult?.resolvedModel) ?? agent.model;
      if (entry.toolUseResult?.isAsync === true || entry.toolUseResult?.status === 'async_launched') {
        agent.background = true;
      }
      if (!agent.background) agent.endTime = at;
    }
  }

  // TodoWrite replaces the list; TaskCreate ids follow their todo by content, in order,
  // so duplicate-content todos each keep their own id.
  private replaceTodos(next: TodoItem[]): void {
    const idsByContent = new Map<string, string[]>();
    for (const [taskId, index] of [...this.taskIndex].sort((a, b) => a[1] - b[1])) {
      const content = this.todos[index]?.content;
      if (content === undefined) continue;
      idsByContent.set(content, [...(idsByContent.get(content) ?? []), taskId]);
    }
    this.todos = [...next];
    this.taskIndex.clear();
    this.todos.forEach((todo, index) => {
      const taskId = idsByContent.get(todo.content)?.shift();
      if (taskId) this.taskIndex.set(taskId, index);
    });
  }

  // TaskUpdate names a task by the id TaskCreate returned, or by its 1-based position.
  private findTask(taskId: unknown): number | null {
    if (typeof taskId !== 'string' && typeof taskId !== 'number') return null;
    const key = String(taskId);
    const mapped = this.taskIndex.get(key);
    if (mapped !== undefined) return mapped;
    const position = /^\d+$/.test(key) ? Number(key) - 1 : -1;
    return position >= 0 && position < this.todos.length ? position : null;
  }

  finish(): TranscriptData {
    for (const [id, endTime] of this.agentCompletions) {
      const agent = this.agents.get(id);
      if (agent?.background) agent.endTime = endTime;
    }
    for (const agent of this.agents.values()) {
      if (agent.endTime) agent.status = 'completed';
    }
    const sessionTokens = { ...this.settled };
    for (const usage of this.usageById.values()) addUsage(sessionTokens, usage);
    return {
      ...this.data,
      tools: [...this.tools.values()].slice(-TOOLS_KEPT),
      agents: [...this.agents.values()].slice(-AGENTS_KEPT),
      skills: [...this.skills],
      mcpServers: [...this.mcpServers],
      mcpErrors: [...this.mcpErrors],
      todos: this.todos,
      sessionTokens,
    };
  }
}

function maxUsage(a: SessionTokenUsage, b: SessionTokenUsage): SessionTokenUsage {
  return {
    inputTokens: Math.max(a.inputTokens, b.inputTokens),
    outputTokens: Math.max(a.outputTokens, b.outputTokens),
    cacheCreationTokens: Math.max(a.cacheCreationTokens, b.cacheCreationTokens),
    cacheReadTokens: Math.max(a.cacheReadTokens, b.cacheReadTokens),
  };
}

export async function parseTranscript(transcriptPath: string): Promise<TranscriptData> {
  try {
    if (!transcriptPath || !fs.statSync(transcriptPath).isFile()) return emptyTranscript();
  } catch {
    return emptyTranscript();
  }
  const parser = new Parser();
  try {
    const input = fs.createReadStream(transcriptPath);
    for await (const raw of readline.createInterface({ input, crlfDelay: Infinity })) {
      parser.line(raw);
    }
  } catch (err) {
    // A read cut short still renders what was parsed.
    debug('Transcript read failed:', err instanceof Error ? err.message : err);
  }
  return parser.finish();
}
