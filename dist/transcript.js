import * as fs from 'fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'readline';
import { createHash } from 'node:crypto';
import { getHudPluginDir } from './claude-config-dir.js';
let createReadStreamImpl = fs.createReadStream;
function getTranscriptCachePath(transcriptPath, homeDir) {
    const hash = createHash('sha256').update(path.resolve(transcriptPath)).digest('hex');
    return path.join(getHudPluginDir(homeDir), 'transcript-cache', `${hash}.json`);
}
function readTranscriptFileState(transcriptPath) {
    try {
        const stat = fs.statSync(transcriptPath);
        if (!stat.isFile()) {
            return null;
        }
        return {
            mtimeMs: stat.mtimeMs,
            size: stat.size,
        };
    }
    catch {
        return null;
    }
}
function serializeTranscriptData(data) {
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
function deserializeTranscriptData(data) {
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
function readTranscriptCache(transcriptPath, state) {
    try {
        const cachePath = getTranscriptCachePath(transcriptPath, os.homedir());
        const raw = fs.readFileSync(cachePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed.transcriptPath !== path.resolve(transcriptPath)
            || parsed.transcriptState?.mtimeMs !== state.mtimeMs
            || parsed.transcriptState?.size !== state.size) {
            return null;
        }
        return deserializeTranscriptData(parsed.data);
    }
    catch {
        return null;
    }
}
function writeTranscriptCache(transcriptPath, state, data) {
    try {
        const cachePath = getTranscriptCachePath(transcriptPath, os.homedir());
        fs.mkdirSync(path.dirname(cachePath), { recursive: true });
        const payload = {
            transcriptPath: path.resolve(transcriptPath),
            transcriptState: state,
            data: serializeTranscriptData(data),
        };
        fs.writeFileSync(cachePath, JSON.stringify(payload), 'utf8');
    }
    catch {
        // Cache failures are non-fatal; fall back to fresh parsing next time.
    }
}
export async function parseTranscript(transcriptPath) {
    const result = {
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
    const toolMap = new Map();
    const agentMap = new Map();
    const bashMap = new Map();
    let latestTodos = [];
    const taskIdToIndex = new Map();
    let latestSlug;
    let customTitle;
    let parsedCleanly = false;
    try {
        const fileStream = createReadStreamImpl(transcriptPath);
        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity,
        });
        for await (const line of rl) {
            if (!line.trim())
                continue;
            try {
                const entry = JSON.parse(line);
                if (entry.type === 'custom-title' && typeof entry.customTitle === 'string') {
                    customTitle = entry.customTitle;
                }
                else if (typeof entry.slug === 'string') {
                    latestSlug = entry.slug;
                }
                processEntry(entry, toolMap, agentMap, bashMap, taskIdToIndex, latestTodos, result);
            }
            catch {
                // Skip malformed lines
            }
        }
        parsedCleanly = true;
    }
    catch {
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
export function _setCreateReadStreamForTests(impl) {
    createReadStreamImpl = impl ?? fs.createReadStream;
}
function processEntry(entry, toolMap, agentMap, bashMap, taskIdToIndex, latestTodos, result) {
    const timestamp = entry.timestamp ? new Date(entry.timestamp) : new Date();
    if (!result.sessionStart && entry.timestamp) {
        result.sessionStart = timestamp;
    }
    const content = entry.message?.content;
    if (!content || !Array.isArray(content))
        return;
    for (const block of content) {
        if (block.type === 'tool_use' && block.id && block.name) {
            const toolEntry = {
                id: block.id,
                name: block.name,
                target: extractTarget(block.name, block.input),
                status: 'running',
                startTime: timestamp,
            };
            if (block.name === 'Bash') {
                const input = block.input;
                bashMap.set(block.id, {
                    id: block.id,
                    command: input?.command ?? '',
                    description: input?.description ?? '',
                    is_background: input?.run_in_background ?? false,
                    output: '',
                    is_error: false,
                    interrupted: false,
                    time: timestamp,
                });
            }
            if (block.name === 'Task') {
                const input = block.input;
                const agentEntry = {
                    id: block.id,
                    type: input?.subagent_type ?? 'unknown',
                    model: input?.model ?? undefined,
                    description: input?.description ?? undefined,
                    status: 'running',
                    startTime: timestamp,
                };
                agentMap.set(block.id, agentEntry);
            }
            else if (block.name === 'TodoWrite') {
                const input = block.input;
                if (input?.todos && Array.isArray(input.todos)) {
                    latestTodos.length = 0;
                    taskIdToIndex.clear();
                    latestTodos.push(...input.todos);
                }
            }
            else if (block.name === 'TaskCreate') {
                const input = block.input;
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
            }
            else if (block.name === 'TaskUpdate') {
                const input = block.input;
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
            }
            else {
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
                }
                else if (Array.isArray(resultContent)) {
                    bash.output = resultContent
                        .filter((c) => c.type === 'text')
                        .map((c) => c.text ?? '')
                        .join('\n');
                }
            }
        }
    }
}
function extractTarget(toolName, input) {
    if (!input)
        return undefined;
    switch (toolName) {
        case 'Read':
        case 'Write':
        case 'Edit':
            return input.file_path ?? input.path;
        case 'Glob':
            return input.pattern;
        case 'Grep':
            return input.pattern;
        case 'Bash':
            const cmd = input.command;
            return cmd?.slice(0, 30) + (cmd?.length > 30 ? '...' : '');
    }
    return undefined;
}
function resolveTaskIndex(taskId, taskIdToIndex, latestTodos) {
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
function normalizeTaskStatus(status) {
    if (typeof status !== 'string')
        return null;
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
//# sourceMappingURL=transcript.js.map