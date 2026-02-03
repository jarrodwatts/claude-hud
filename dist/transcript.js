import * as fs from 'fs';
import * as readline from 'readline';
export async function parseTranscript(transcriptPath) {
    const result = {
        tools: [],
        agents: [],
        todos: [],
    };
    if (!transcriptPath || !fs.existsSync(transcriptPath)) {
        return result;
    }
    const toolMap = new Map();
    const agentMap = new Map();
    let latestTodos = [];
    const taskIdToIndex = new Map();
    try {
        const fileStream = fs.createReadStream(transcriptPath);
        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity,
        });
        for await (const line of rl) {
            if (!line.trim())
                continue;
            try {
                const entry = JSON.parse(line);
                processEntry(entry, toolMap, agentMap, taskIdToIndex, latestTodos, result);
            }
            catch {
                // Skip malformed lines
            }
        }
    }
    catch {
        // Return partial results on error
    }
    result.tools = Array.from(toolMap.values()).slice(-20);
    result.agents = Array.from(agentMap.values()).slice(-10);
    result.todos = latestTodos;
    return result;
}
function processEntry(entry, toolMap, agentMap, taskIdToIndex, latestTodos, result) {
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