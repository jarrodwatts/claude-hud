import { getContextPercent, getModelName } from '../stdin.js';
import { coloredBar, cyan, dim, magenta, yellow, getContextColor, RESET } from './colors.js';
export function renderSessionLine(ctx) {
    const model = getModelName(ctx.stdin);
    const percent = getContextPercent(ctx.stdin);
    const bar = coloredBar(percent);
    const parts = [];
    // Show project path first (configurable path levels, default 1)
    if (ctx.stdin.cwd) {
        // Split by both Unix (/) and Windows (\) separators for cross-platform support
        const segments = ctx.stdin.cwd.split(/[/\\]/).filter(Boolean);
        const pathLevels = ctx.config?.pathLevels ?? 1;
        // Always join with forward slash for consistent display
        const projectPath = segments.slice(-pathLevels).join('/');
        // Build git status string
        let gitPart = '';
        const gitConfig = ctx.config?.gitStatus;
        const showGit = gitConfig?.enabled ?? true;
        if (showGit && ctx.gitStatus) {
            const gitParts = [ctx.gitStatus.branch];
            // Show dirty indicator
            if ((gitConfig?.showDirty ?? true) && ctx.gitStatus.isDirty) {
                gitParts.push('*');
            }
            // Show ahead/behind
            if (gitConfig?.showAheadBehind) {
                if (ctx.gitStatus.ahead > 0) {
                    gitParts.push(`↑${ctx.gitStatus.ahead}`);
                }
                if (ctx.gitStatus.behind > 0) {
                    gitParts.push(`↓${ctx.gitStatus.behind}`);
                }
            }
            gitPart = ` ${magenta('git:(')}${cyan(gitParts.join(''))}${magenta(')')}`;
        }
        parts.push(`${yellow(projectPath)}${gitPart}`);
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