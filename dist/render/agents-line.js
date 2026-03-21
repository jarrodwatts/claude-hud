import { yellow, green, magenta, dim } from './colors.js';
import { truncateString } from '../utils/format.js';
export function renderAgentsLine(ctx) {
    const { agents } = ctx.transcript;
    const runningAgents = agents.filter((a) => a.status === 'running');
    const recentCompleted = agents
        .filter((a) => a.status === 'completed')
        .slice(-2);
    const toShow = [...runningAgents, ...recentCompleted].slice(-3);
    if (toShow.length === 0) {
        return null;
    }
    const lines = [];
    for (const agent of toShow) {
        lines.push(formatAgent(agent));
    }
    return lines.join('\n');
}
function formatAgent(agent) {
    const statusIcon = agent.status === 'running' ? yellow('◐') : green('✓');
    const type = magenta(agent.type);
    const model = agent.model ? dim(`[${agent.model}]`) : '';
    const desc = agent.description ? dim(`: ${truncateString(agent.description, 40)}`) : '';
    const elapsed = formatElapsed(agent);
    return `${statusIcon} ${type}${model ? ` ${model}` : ''}${desc} ${dim(`(${elapsed})`)}`;
}
function formatElapsed(agent) {
    const now = Date.now();
    const start = agent.startTime.getTime();
    const end = agent.endTime?.getTime() ?? now;
    const ms = end - start;
    if (ms < 1000)
        return '<1s';
    if (ms < 60000)
        return `${Math.round(ms / 1000)}s`;
    const mins = Math.floor(ms / 60000);
    const secs = Math.round((ms % 60000) / 1000);
    return `${mins}m ${secs}s`;
}
//# sourceMappingURL=agents-line.js.map