import path from 'node:path';
import { getContextPercent, getModelName } from '../stdin.js';
import { coloredBar, cyan, dim, red, getContextColor, RESET } from './colors.js';
export function renderSessionLine(ctx) {
    const model = getModelName(ctx.stdin);
    const percent = getContextPercent(ctx.stdin);
    const bar = coloredBar(percent);
    const parts = [];
    // Add project folder name and git branch (styled like terminal prompt)
    if (ctx.stdin.cwd) {
        const projectName = path.basename(ctx.stdin.cwd) || ctx.stdin.cwd;
        const branchPart = ctx.gitBranch ? ` ${cyan(`git:(${ctx.gitBranch})`)}` : '';
        parts.push(`${red(projectName)}${branchPart}`);
    }
    parts.push(`${cyan(`[${model}]`)} ${bar} ${getContextColor(percent)}${percent}%${RESET}`);
    if (ctx.claudeMdCount > 0) {
        parts.push(dim(`${ctx.claudeMdCount} CLAUDE.md`));
    }
    if (ctx.rulesCount > 0) {
        parts.push(dim(`${ctx.rulesCount} rules`));
    }
    if (ctx.mcpCount > 0) {
        parts.push(dim(`${ctx.mcpCount} MCPs`));
    }
    if (ctx.hooksCount > 0) {
        parts.push(dim(`${ctx.hooksCount} hooks`));
    }
    if (ctx.sessionDuration) {
        parts.push(dim(`⏱️  ${ctx.sessionDuration}`));
    }
    let line = parts.join(' | ');
    if (percent >= 85) {
        const usage = ctx.stdin.context_window?.current_usage;
        if (usage) {
            const input = formatTokens(usage.input_tokens ?? 0);
            const cache = formatTokens((usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0));
            line += dim(` (in: ${input}, cache: ${cache})`);
        }
    }
    if (percent >= 95) {
        line += ` ${red('⚠️ COMPACT')}`;
    }
    return line;
}
function formatTokens(n) {
    if (n >= 1000000) {
        return `${(n / 1000000).toFixed(1)}M`;
    }
    if (n >= 1000) {
        return `${(n / 1000).toFixed(0)}k`;
    }
    return n.toString();
}
//# sourceMappingURL=session-line.js.map