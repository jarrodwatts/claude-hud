import { renderSessionLine } from './session-line.js';
import { renderToolsLine } from './tools-line.js';
import { renderAgentsLine } from './agents-line.js';
import { renderTodosLine } from './todos-line.js';
import { RESET } from './colors.js';
export function render(ctx) {
    const lines = [];
    const sessionLine = renderSessionLine(ctx);
    if (sessionLine) {
        lines.push(sessionLine);
    }
    const toolsLine = renderToolsLine(ctx);
    if (toolsLine) {
        lines.push(toolsLine);
    }
    const agentsLine = renderAgentsLine(ctx);
    if (agentsLine) {
        lines.push(agentsLine);
    }
    const todosLine = renderTodosLine(ctx);
    if (todosLine) {
        lines.push(todosLine);
    }
    for (const line of lines) {
        const outputLine = `${RESET}${line.replace(/ /g, '\u00A0')}`;
        console.log(outputLine);
    }
}
//# sourceMappingURL=index.js.map