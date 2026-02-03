import { renderSessionLine } from './session-line.js';
import { renderToolsLine } from './tools-line.js';
import { renderAgentsLine } from './agents-line.js';
import { renderTodosLine } from './todos-line.js';
import { renderIdentityLine, renderProjectLine, renderEnvironmentLine, renderUsageLine, } from './lines/index.js';
import { dim, RESET } from './colors.js';
function stripAnsi(str) {
    // eslint-disable-next-line no-control-regex
    return str.replace(/\x1b\[[0-9;]*m/g, '');
}
function visualLength(str) {
    return stripAnsi(str).length;
}
function getTerminalWidth() {
    const columns = process.stdout.columns;
    if (typeof columns === 'number' && Number.isFinite(columns) && columns > 0) {
        return columns;
    }
    const envColumns = Number.parseInt(process.env.COLUMNS ?? '', 10);
    if (Number.isFinite(envColumns) && envColumns > 0) {
        return envColumns;
    }
    return null;
}
function truncateLine(line, maxWidth) {
    if (maxWidth <= 0)
        return '';
    if (maxWidth <= 3)
        return '.'.repeat(maxWidth);
    if (visualLength(line) <= maxWidth)
        return line;
    const limit = Math.max(0, maxWidth - 3);
    let visible = 0;
    let result = '';
    const ansiPattern = /\x1b\[[0-9;]*m/g;
    let lastIndex = 0;
    let match;
    while ((match = ansiPattern.exec(line)) !== null) {
        const chunk = line.slice(lastIndex, match.index);
        for (const char of chunk) {
            if (visible >= limit) {
                return result + '...';
            }
            result += char;
            visible += 1;
        }
        result += match[0];
        lastIndex = ansiPattern.lastIndex;
    }
    const remaining = line.slice(lastIndex);
    for (const char of remaining) {
        if (visible >= limit) {
            return result + '...';
        }
        result += char;
        visible += 1;
    }
    return result + '...';
}
function collectActivityLines(ctx) {
    const activityLines = [];
    const display = ctx.config?.display;
    if (display?.showTools !== false) {
        const toolsLine = renderToolsLine(ctx);
        if (toolsLine) {
            activityLines.push(toolsLine);
        }
    }
    if (display?.showAgents !== false) {
        const agentsLine = renderAgentsLine(ctx);
        if (agentsLine) {
            activityLines.push(agentsLine);
        }
    }
    if (display?.showTodos !== false) {
        const todosLine = renderTodosLine(ctx);
        if (todosLine) {
            activityLines.push(todosLine);
        }
    }
    return activityLines;
}
function renderCompact(ctx) {
    const lines = [];
    const sessionLine = renderSessionLine(ctx);
    if (sessionLine) {
        lines.push(sessionLine);
    }
    return lines;
}
function renderExpanded(ctx) {
    const lines = [];
    const identityLine = renderIdentityLine(ctx);
    if (identityLine) {
        lines.push(identityLine);
    }
    const projectLine = renderProjectLine(ctx);
    if (projectLine) {
        lines.push(projectLine);
    }
    const environmentLine = renderEnvironmentLine(ctx);
    if (environmentLine) {
        lines.push(environmentLine);
    }
    // Only show separate usage line when usageBarEnabled is false
    // When true, usage is rendered inline with identity line
    const usageBarEnabled = ctx.config?.display?.usageBarEnabled ?? true;
    if (!usageBarEnabled) {
        const usageLine = renderUsageLine(ctx);
        if (usageLine) {
            lines.push(usageLine);
        }
    }
    return lines;
}
export function render(ctx) {
    const lineLayout = ctx.config?.lineLayout ?? 'expanded';
    const showSeparators = ctx.config?.showSeparators ?? false;
    const headerLines = lineLayout === 'expanded' ? renderExpanded(ctx) : renderCompact(ctx);
    const activityLines = collectActivityLines(ctx);
    const headerSegments = [];
    for (const line of headerLines) {
        if (!line)
            continue;
        const split = line.split('\n').filter((part) => part.length > 0);
        headerSegments.push(...split);
    }
    const activitySegments = [];
    for (const line of activityLines) {
        if (!line)
            continue;
        const split = line.split('\n').filter((part) => part.length > 0);
        activitySegments.push(...split);
    }
    const segments = [...headerSegments];
    if (showSeparators && headerSegments.length > 0 && activitySegments.length > 0) {
        segments.push(dim('---'));
    }
    segments.push(...activitySegments);
    if (segments.length === 0) {
        return;
    }
    // Keep HUD to a single terminal line to avoid focusable rows in the UI.
    let line = segments.join(' | ');
    const maxWidth = getTerminalWidth();
    if (maxWidth) {
        line = truncateLine(line, maxWidth);
    }
    const outputLine = `${RESET}${line}${RESET}`.replace(/ /g, '\u00A0');
    console.log(outputLine);
}
//# sourceMappingURL=index.js.map