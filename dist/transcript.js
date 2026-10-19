import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { createHash } from 'node:crypto';
import { getHudPluginDir } from './claude-config-dir.js';
import { createDebug } from './debug.js';
import { sanitizeDisplayText } from './utils/sanitize.js';
import { sanitizeTranscriptModel } from './model-source.js';
const debug = createDebug('transcript');
const TOOLS_KEPT = 20;
const AGENTS_KEPT = 10;
// Tools are tracked beyond those shown so an MCP call's late error still counts, but
// bounded so the saved parser state stays small however long the session runs.
const TOOLS_TRACKED = 256;
const NAME_MAX_LEN = 64;
const ADVISOR_MODEL_MAX_LEN = 64;
const MESSAGE_ID_MAX_LEN = 128;
const MESSAGE_IDS_MAX = 4096;
const MCP_ERRORS_MAX = 64;
const MCP_TOOL = /^mcp__(.+?)__(.+)$/;
// Claude Code's /effort output; anchored so prose quoting it can't flip ultracode.
const EFFORT_COMMAND = /^<local-command-stdout>Set effort level to (\w+)/;
const emptyTranscript = () => ({ tools: [], skills: [], mcpServers: [], mcpErrors: [], agents: [], todos: [] });
const ZERO_USAGE = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
const USAGE_FIELDS = Object.keys(ZERO_USAGE);
const count = (value) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
function addUsage(total, usage) {
    for (const field of USAGE_FIELDS)
        total[field] += usage[field];
}
function name(value) {
    if (typeof value !== 'string')
        return undefined;
    const text = sanitizeDisplayText(value).trim();
    if (!text)
        return undefined;
    return text.length <= NAME_MAX_LEN ? text : `${text.slice(0, NAME_MAX_LEN - 1)}…`;
}
const mcpServer = (toolName) => name(MCP_TOOL.exec(toolName)?.[1]);
// Tool inputs are written by the model, so their text is untrusted terminal input.
const text = (value) => typeof value === 'string' ? sanitizeDisplayText(value) || undefined : undefined;
function toolTarget(toolName, input) {
    if (!input)
        return undefined;
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
            if (!command)
                return undefined;
            return command.length > 30 ? `${command.slice(0, 30).trimEnd()}...` : command;
        }
    }
    return undefined;
}
function taskStatus(status) {
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
function toTodo(value) {
    const todo = value;
    const content = text(todo?.content);
    const status = taskStatus(todo?.status);
    return content && status ? [{ content, status }] : [];
}
class Parser {
    // Every field must round-trip through save() and load(), or a resumed read loses it.
    tools = new Map();
    agents = new Map();
    skills = new Set();
    mcpServers = new Set();
    mcpErrors = new Set();
    todos = [];
    taskIndex = new Map();
    agentCompletions = new Map();
    // Some task-notifications omit <tool-use-id>, carrying only <task-id> (= the
    // launch toolUseResult's agentId). Map agentId -> toolUseId from the launch
    // result so those notifications can still resolve completion.
    agentIdToToolUseId = new Map();
    // Claude Code logs one API response several times, sometimes non-adjacently, so usage
    // is the per-field max per message id. Ids evicted to bound memory settle into `settled`.
    usageById = new Map();
    settled = { ...ZERO_USAGE };
    lastIdlessUsage;
    data = { ...emptyTranscript(), compactionCount: 0 };
    line(raw) {
        let entry = null;
        try {
            entry = raw.trim() ? JSON.parse(raw) : null;
        }
        catch {
            // Malformed lines are skipped.
        }
        if (!entry || typeof entry !== 'object') {
            this.lastIdlessUsage = undefined;
            return;
        }
        const time = entry.timestamp ? new Date(entry.timestamp) : null;
        const at = time && !Number.isNaN(time.getTime()) ? time : null;
        if (at && !this.data.sessionStart)
            this.data.sessionStart = at;
        if (entry.type === 'assistant') {
            this.assistant(entry, at);
        }
        else {
            this.lastIdlessUsage = undefined;
        }
        if (entry.type === 'user' && typeof entry.message?.content === 'string') {
            const effort = EFFORT_COMMAND.exec(entry.message.content);
            if (effort)
                this.data.ultracodeActive = effort[1].toLowerCase() === 'ultracode';
        }
        if (entry.type === 'attachment') {
            if (entry.attachment?.type === 'ultra_effort_enter')
                this.data.ultracodeActive = true;
            if (entry.attachment?.type === 'ultra_effort_exit')
                this.data.ultracodeActive = false;
        }
        if (entry.type === 'system' && entry.subtype === 'compact_boundary' && at) {
            this.data.compactionCount = (this.data.compactionCount ?? 0) + 1;
            const post = entry.compactMetadata?.postTokens;
            this.data.contextTokens = typeof post === 'number' && Number.isFinite(post) && post >= 0 ? Math.trunc(post) : undefined;
        }
        // A background agent's tool_result lands at launch; its completion is this enqueue,
        // or (forked/resumed sessions) a queued_command attachment carrying the same notice.
        const notice = entry.type === 'queue-operation' && entry.operation === 'enqueue' ? entry.content
            : entry.type === 'attachment' && entry.attachment?.type === 'queued_command' ? entry.attachment.prompt
                : undefined;
        if (typeof notice === 'string' && at) {
            const taskId = /<task-id>([^<]+)<\/task-id>/.exec(notice)?.[1];
            const toolUseId = /<tool-use-id>([^<]+)<\/tool-use-id>/.exec(notice)?.[1] ??
                (taskId ? this.agentIdToToolUseId.get(taskId) : undefined);
            // Both carriers can log the same notice; the earliest is when the agent finished.
            // Background Bash and Monitor tasks send the same notice; only agents' are kept.
            const prev = toolUseId && this.agentCompletions.get(toolUseId);
            if (toolUseId && taskId && this.agents.has(toolUseId) && !(prev && prev <= at))
                this.agentCompletions.set(toolUseId, at);
        }
        if (Array.isArray(entry.message?.content)) {
            for (const block of entry.message.content) {
                if (block?.type === 'tool_use' && block.id && block.name)
                    this.toolUse(block, at ?? new Date());
                if (block?.type === 'tool_result' && block.tool_use_id)
                    this.toolResult(block, entry, at ?? new Date());
            }
        }
    }
    assistant(entry, at) {
        if (at)
            this.data.lastAssistantResponseAt = at;
        if (typeof entry.advisorModel === 'string' && entry.advisorModel) {
            this.data.advisorModel = entry.advisorModel.slice(0, ADVISOR_MODEL_MAX_LEN);
        }
        const model = sanitizeTranscriptModel(entry.message?.model);
        // Claude Code writes '<synthetic>' on assistant records it generates locally.
        if (model && model !== '<synthetic>')
            this.data.lastAssistantModel = model;
        const raw = entry.message?.usage;
        if (!raw) {
            this.lastIdlessUsage = undefined;
            return;
        }
        const usage = {
            inputTokens: count(raw.input_tokens),
            outputTokens: count(raw.output_tokens),
            cacheCreationTokens: count(raw.cache_creation_input_tokens),
            cacheReadTokens: count(raw.cache_read_input_tokens),
        };
        // A main-conversation request always sends some context, so zero is a placeholder: gateways that
        // write one record per content block give thinking blocks all-zero usage. Keep the last real size.
        const contextTokens = usage.inputTokens + usage.cacheCreationTokens + usage.cacheReadTokens;
        if (entry.isSidechain !== true && contextTokens > 0) {
            this.data.contextTokens = contextTokens;
        }
        const id = entry.message?.id;
        if (typeof id === 'string' && id && id.length <= MESSAGE_ID_MAX_LEN) {
            this.lastIdlessUsage = undefined;
            const previous = this.usageById.get(id);
            this.usageById.set(id, previous ? maxUsage(previous, usage) : usage);
            if (this.usageById.size > MESSAGE_IDS_MAX) {
                const [oldestId, oldest] = this.usageById.entries().next().value;
                this.usageById.delete(oldestId);
                addUsage(this.settled, oldest);
            }
            return;
        }
        // Without an id, only an identical record right after the previous one is a duplicate.
        const fingerprint = JSON.stringify(usage);
        if (fingerprint !== this.lastIdlessUsage)
            addUsage(this.settled, usage);
        this.lastIdlessUsage = fingerprint;
    }
    toolUse(block, at) {
        const toolName = block.name;
        const input = block.input;
        const skill = toolName === 'Skill' ? name(input?.skill) : undefined;
        if (skill)
            this.skills.add(skill);
        const server = mcpServer(toolName);
        if (server)
            this.mcpServers.add(server);
        if (toolName === 'Task' || toolName === 'Agent') {
            this.agents.set(block.id, {
                id: block.id,
                type: input?.subagent_type ?? 'agent',
                model: sanitizeTranscriptModel(input?.model),
                description: input?.description ?? undefined,
                status: 'running',
                startTime: at,
                background: input?.run_in_background === true,
            });
            if (cap(this.agents, AGENTS_KEPT)) {
                // Completions and launch ids only matter for agents still tracked.
                for (const id of this.agentCompletions.keys())
                    if (!this.agents.has(id))
                        this.agentCompletions.delete(id);
                for (const [agentId, id] of this.agentIdToToolUseId)
                    if (!this.agents.has(id))
                        this.agentIdToToolUseId.delete(agentId);
            }
        }
        else if (toolName === 'TodoWrite') {
            if (Array.isArray(input?.todos))
                this.replaceTodos(input.todos.flatMap(toTodo));
        }
        else if (toolName === 'TaskCreate') {
            const content = text(input?.subject) ?? text(input?.description);
            this.todos.push({ content: content ?? 'Untitled task', status: taskStatus(input?.status) ?? 'pending' });
            const taskId = typeof input?.taskId === 'string' || typeof input?.taskId === 'number' ? String(input.taskId) : block.id;
            if (taskId)
                this.taskIndex.set(taskId, this.todos.length - 1);
        }
        else if (toolName === 'TaskUpdate') {
            const todo = this.todos[this.findTask(input?.taskId) ?? -1];
            if (!todo)
                return;
            const status = taskStatus(input?.status);
            if (status)
                todo.status = status;
            const content = text(input?.subject) ?? text(input?.description);
            if (content)
                todo.content = content;
        }
        else {
            this.tools.set(block.id, {
                id: block.id,
                name: toolName,
                target: toolTarget(toolName, input),
                status: 'running',
                startTime: at,
            });
            cap(this.tools, TOOLS_TRACKED);
        }
    }
    toolResult(block, entry, at) {
        const id = block.tool_use_id;
        const tool = this.tools.get(id);
        if (tool) {
            tool.status = block.is_error ? 'error' : 'completed';
            tool.endTime = at;
            const server = mcpServer(tool.name);
            if (server && block.is_error) {
                this.mcpErrors.add(server);
                cap(this.mcpErrors, MCP_ERRORS_MAX);
            }
            else if (server) {
                this.mcpErrors.delete(server);
            }
        }
        const agent = this.agents.get(id);
        if (agent) {
            const agentId = entry.toolUseResult?.agentId;
            if (typeof agentId === 'string' && agentId) {
                this.agentIdToToolUseId.set(agentId, id);
                agent.agentId = agentId;
            }
            // resolvedModel is what the subagent actually ran on, so it beats the caller's alias.
            agent.model = sanitizeTranscriptModel(entry.toolUseResult?.resolvedModel) ?? agent.model;
            if (entry.toolUseResult?.isAsync === true || entry.toolUseResult?.status === 'async_launched') {
                agent.background = true;
            }
            if (!agent.background)
                agent.endTime = at;
        }
    }
    // TodoWrite replaces the list; TaskCreate ids follow their todo by content, in order,
    // so duplicate-content todos each keep their own id.
    replaceTodos(next) {
        const idsByContent = new Map();
        for (const [taskId, index] of [...this.taskIndex].sort((a, b) => a[1] - b[1])) {
            const content = this.todos[index]?.content;
            if (content === undefined)
                continue;
            idsByContent.set(content, [...(idsByContent.get(content) ?? []), taskId]);
        }
        this.todos = [...next];
        this.taskIndex.clear();
        this.todos.forEach((todo, index) => {
            const taskId = idsByContent.get(todo.content)?.shift();
            if (taskId)
                this.taskIndex.set(taskId, index);
        });
    }
    // TaskUpdate names a task by the id TaskCreate returned, or by its 1-based position.
    findTask(taskId) {
        if (typeof taskId !== 'string' && typeof taskId !== 'number')
            return null;
        const key = String(taskId);
        const mapped = this.taskIndex.get(key);
        if (mapped !== undefined)
            return mapped;
        const position = /^\d+$/.test(key) ? Number(key) - 1 : -1;
        return position >= 0 && position < this.todos.length ? position : null;
    }
    // Maps and Sets become arrays so the state round-trips through JSON.
    save() {
        return {
            tools: [...this.tools],
            agents: [...this.agents],
            skills: [...this.skills],
            mcpServers: [...this.mcpServers],
            mcpErrors: [...this.mcpErrors],
            todos: this.todos,
            taskIndex: [...this.taskIndex],
            agentCompletions: [...this.agentCompletions],
            agentIdToToolUseId: [...this.agentIdToToolUseId],
            usageById: [...this.usageById],
            settled: this.settled,
            lastIdlessUsage: this.lastIdlessUsage,
            data: this.data,
        };
    }
    // `s` comes from JSON read with reviveDates; Map entries are [key, value] pairs the
    // reviver can't see, so their Dates are rebuilt here.
    static load(s) {
        const parser = new Parser();
        parser.tools = new Map(s.tools);
        parser.agents = new Map(s.agents);
        parser.skills = new Set(s.skills);
        parser.mcpServers = new Set(s.mcpServers);
        parser.mcpErrors = new Set(s.mcpErrors);
        parser.todos = s.todos;
        parser.taskIndex = new Map(s.taskIndex);
        parser.agentCompletions = new Map(s.agentCompletions.map(([id, at]) => [id, new Date(at)]));
        parser.agentIdToToolUseId = new Map(s.agentIdToToolUseId);
        parser.usageById = new Map(s.usageById);
        parser.settled = s.settled;
        parser.lastIdlessUsage = s.lastIdlessUsage;
        parser.data = s.data;
        return parser;
    }
    finish() {
        for (const [id, endTime] of this.agentCompletions) {
            const agent = this.agents.get(id);
            if (agent?.background)
                agent.endTime = endTime;
        }
        for (const agent of this.agents.values()) {
            if (agent.endTime)
                agent.status = 'completed';
        }
        const sessionTokens = { ...this.settled };
        for (const usage of this.usageById.values())
            addUsage(sessionTokens, usage);
        return {
            ...this.data,
            tools: [...this.tools.values()].slice(-TOOLS_KEPT),
            agents: [...this.agents.values()],
            skills: [...this.skills],
            mcpServers: [...this.mcpServers],
            mcpErrors: [...this.mcpErrors],
            todos: this.todos,
            sessionTokens,
        };
    }
}
// The Date fields of ToolEntry, AgentEntry, and TranscriptData.
const DATE_KEYS = new Set(['startTime', 'endTime', 'sessionStart', 'lastAssistantResponseAt']);
const reviveDates = (key, value) => DATE_KEYS.has(key) && typeof value === 'string' ? new Date(value) : value;
/** Drops the oldest entries past `max`, returning whether any went. */
function cap(collection, max) {
    const over = collection.size > max;
    for (const key of collection.keys()) {
        if (collection.size <= max)
            break;
        collection.delete(key);
    }
    return over;
}
function maxUsage(a, b) {
    return {
        inputTokens: Math.max(a.inputTokens, b.inputTokens),
        outputTokens: Math.max(a.outputTokens, b.outputTokens),
        cacheCreationTokens: Math.max(a.cacheCreationTokens, b.cacheCreationTokens),
        cacheReadTokens: Math.max(a.cacheReadTokens, b.cacheReadTokens),
    };
}
const CURSORS_KEPT = 32;
const CHUNK_BYTES = 1 << 20;
// A first read of a huge file can outlast Claude Code's wait, so it saves as it goes
// and the next run carries on from there.
const CHECKPOINT_BYTES = 32 << 20;
const NEWLINE = 0x0a;
// A release may parse differently, so its state starts over.
let hudVersion;
function getHudVersion() {
    if (hudVersion === undefined) {
        try {
            hudVersion = String(JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
        }
        catch {
            hudVersion = '';
        }
    }
    return hudVersion;
}
function cursorPath(homeDir, transcriptPath) {
    const key = createHash('sha256').update(path.resolve(transcriptPath)).digest('hex');
    return path.join(getHudPluginDir(homeDir), 'transcript-cursors', `${key}.json`);
}
function readCursor(file) {
    let cursor;
    try {
        cursor = JSON.parse(fs.readFileSync(file, 'utf8'), reviveDates);
    }
    catch {
        return null;
    }
    if (typeof cursor !== 'object' || cursor === null)
        return null;
    if (cursor.version !== getHudVersion() || typeof cursor.ino !== 'number')
        return null;
    if (typeof cursor.offset !== 'number' || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0)
        return null;
    return cursor;
}
function writeCursor(file, cursor) {
    try {
        const dir = path.dirname(file);
        const isNew = !fs.existsSync(file);
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        const tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(cursor), { mode: 0o600 });
        fs.renameSync(tmp, file);
        if (isNew)
            pruneCursors(dir);
    }
    catch (err) {
        // Without a cursor the next run just rereads the whole file.
        debug('Transcript cursor write failed:', err instanceof Error ? err.message : err);
    }
}
// Keeps the 32 most recently written files, stray temp files from a killed run included.
function pruneCursors(dir) {
    const files = fs.readdirSync(dir).map((name) => path.join(dir, name));
    if (files.length <= CURSORS_KEPT)
        return;
    const byAge = files.map((file) => ({ file, mtime: fs.statSync(file).mtimeMs })).sort((a, b) => a.mtime - b.mtime);
    for (const { file } of byAge.slice(0, files.length - CURSORS_KEPT))
        fs.rmSync(file, { force: true });
}
// The saved state still fits the file only if it is the same file, no shorter, and the
// offset still sits just past a newline (a rewritten file usually breaks that).
async function resumes(file, stat, cursor) {
    if (cursor.ino !== stat.ino || cursor.offset > stat.size)
        return false;
    if (cursor.offset === 0)
        return true;
    const { bytesRead, buffer } = await file.read(Buffer.alloc(1), 0, 1, cursor.offset - 1);
    return bytesRead === 1 && buffer[0] === NEWLINE;
}
/**
 * Feeds each complete line from `start` on, with the offset just past it. Returns the
 * offset after the last newline and the unterminated rest.
 */
async function readLines(file, start, onLine) {
    const buffer = Buffer.alloc(CHUNK_BYTES);
    let pending = [];
    let end = start;
    let position = start;
    while (true) {
        let bytesRead;
        try {
            ({ bytesRead } = await file.read(buffer, 0, CHUNK_BYTES, position));
        }
        catch (err) {
            // A read cut short still renders, and saves, what was parsed.
            debug('Transcript read failed:', err instanceof Error ? err.message : err);
            break;
        }
        if (bytesRead === 0)
            break;
        const chunk = buffer.subarray(0, bytesRead);
        let from = 0;
        let newline;
        while ((newline = chunk.indexOf(NEWLINE, from)) !== -1) {
            const piece = chunk.subarray(from, newline);
            end = position + newline + 1;
            onLine((pending.length > 0 ? Buffer.concat([...pending, piece]) : piece).toString('utf8'), end);
            pending = [];
            from = newline + 1;
        }
        // Copied, since the buffer is reused for the next chunk.
        if (from < bytesRead)
            pending.push(Buffer.from(chunk.subarray(from)));
        position += bytesRead;
    }
    return { end, rest: Buffer.concat(pending).toString('utf8') };
}
/** Parses from `offset` to the end, saving the state as it goes. */
async function parseFrom(file, parser, offset, save) {
    let saved = offset;
    const { end, rest } = await readLines(file, offset, (line, lineEnd) => {
        parser.line(line);
        if (lineEnd - saved >= CHECKPOINT_BYTES) {
            save(parser, lineEnd);
            saved = lineEnd;
        }
    });
    if (end > saved)
        save(parser, end);
    // An unterminated last line may still be being written: it counts for this
    // render but isn't saved, and the next run reads it again once it ends.
    if (rest)
        parser.line(rest);
    return parser.finish();
}
export async function parseTranscript(transcriptPath, homeDir) {
    let file;
    try {
        // Checked before opening, which would block on a pipe.
        if (!transcriptPath || !(await fs.promises.stat(transcriptPath)).isFile())
            return emptyTranscript();
        file = await fs.promises.open(transcriptPath, 'r');
    }
    catch {
        return emptyTranscript();
    }
    try {
        const stat = await file.stat();
        const cursorFile = cursorPath(homeDir, transcriptPath);
        const save = (parser, offset) => writeCursor(cursorFile, { version: getHudVersion(), ino: stat.ino, offset, state: parser.save() });
        const cursor = readCursor(cursorFile);
        if (cursor && (await resumes(file, stat, cursor))) {
            try {
                return await parseFrom(file, Parser.load(cursor.state), cursor.offset, save);
            }
            catch (err) {
                debug('Saved transcript state unusable, rereading:', err instanceof Error ? err.message : err);
            }
        }
        return await parseFrom(file, new Parser(), 0, save);
    }
    catch (err) {
        debug('Transcript read failed:', err instanceof Error ? err.message : err);
        return emptyTranscript();
    }
    finally {
        await file.close();
    }
}
// The id comes from the transcript and names a file, so only a plain token is used.
const AGENT_ID = /^[\w-]{1,64}$/;
/** A subagent's effort, from the first assistant record of `<session>/subagents/agent-<id>.jsonl`. */
async function subagentEffort(transcriptPath, agentId) {
    if (!AGENT_ID.test(agentId))
        return undefined;
    const file = path.join(path.dirname(transcriptPath), path.basename(transcriptPath, '.jsonl'), 'subagents', `agent-${agentId}.jsonl`);
    try {
        // Checked before opening, which would block on a pipe.
        if (!(await fs.promises.stat(file)).isFile())
            return undefined;
    }
    catch {
        return undefined;
    }
    // A stream rather than readLines, so the scan stops at the first reply.
    const input = fs.createReadStream(file);
    try {
        for await (const raw of readline.createInterface({ input, crlfDelay: Infinity })) {
            let entry = null;
            try {
                entry = JSON.parse(raw);
            }
            catch {
                continue;
            }
            if (entry?.type === 'assistant')
                return typeof entry.effort === 'string' ? entry.effort : undefined;
        }
    }
    catch {
        // Gone mid-read.
    }
    finally {
        input.destroy();
    }
    return undefined;
}
/** Sets each agent's effort in place; agents without a known id or first reply stay without one. */
export async function addSubagentEfforts(transcriptPath, agents) {
    await Promise.all(agents.map(async (agent) => {
        if (agent.agentId)
            agent.effort = await subagentEffort(transcriptPath, agent.agentId);
    }));
}
//# sourceMappingURL=transcript.js.map