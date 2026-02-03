import { isLimitReached } from '../types.js';
import { getContextPercent, getBufferedPercent, getModelName, getTotalTokens } from '../stdin.js';
import { coloredBar, cyan, dim, magenta, red, yellow, getContextColor, quotaBar, RESET } from './colors.js';
const DEBUG = process.env.DEBUG?.includes('claude-hud') || process.env.DEBUG === '*';
/**
 * Renders the full session line (model + context bar + project + git + counts + usage + duration).
 * Used for compact layout mode.
 */
export function renderSessionLine(ctx) {
    const model = getModelName(ctx.stdin);
    const rawPercent = getContextPercent(ctx.stdin);
    const bufferedPercent = getBufferedPercent(ctx.stdin);
    const autocompactMode = ctx.config?.display?.autocompactBuffer ?? 'enabled';
    const percent = autocompactMode === 'disabled' ? rawPercent : bufferedPercent;
    if (DEBUG && autocompactMode === 'disabled') {
        console.error(`[claude-hud:context] autocompactBuffer=disabled, showing raw ${rawPercent}% (buffered would be ${bufferedPercent}%)`);
    }
    const bar = coloredBar(percent);
    const parts = [];
    const display = ctx.config?.display;
    const contextValueMode = display?.contextValue ?? 'percent';
    const contextValue = formatContextValue(ctx, percent, contextValueMode);
    const contextValueDisplay = `${getContextColor(percent)}${contextValue}${RESET}`;
    // Model and context bar (FIRST)
    // Plan name only shows if showUsage is enabled (respects hybrid toggle)
    const planName = display?.showUsage !== false ? ctx.usageData?.planName : undefined;
    const modelDisplay = planName ? `${model} | ${planName}` : model;
    if (display?.showModel !== false && display?.showContextBar !== false) {
        parts.push(`${cyan(`[${modelDisplay}]`)} ${bar} ${contextValueDisplay}`);
    }
    else if (display?.showModel !== false) {
        parts.push(`${cyan(`[${modelDisplay}]`)} ${contextValueDisplay}`);
    }
    else if (display?.showContextBar !== false) {
        parts.push(`${bar} ${contextValueDisplay}`);
    }
    else {
        parts.push(contextValueDisplay);
    }
    // Project path (SECOND)
    if (ctx.stdin.cwd) {
        // Split by both Unix (/) and Windows (\) separators for cross-platform support
        const segments = ctx.stdin.cwd.split(/[/\\]/).filter(Boolean);
        const pathLevels = ctx.config?.pathLevels ?? 1;
        // Always join with forward slash for consistent display
        // Handle root path (/) which results in empty segments
        const projectPath = segments.length > 0 ? segments.slice(-pathLevels).join('/') : '/';
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
            // Show ahead/behind (with space separator for readability)
            if (gitConfig?.showAheadBehind) {
                if (ctx.gitStatus.ahead > 0) {
                    gitParts.push(` ↑${ctx.gitStatus.ahead}`);
                }
                if (ctx.gitStatus.behind > 0) {
                    gitParts.push(` ↓${ctx.gitStatus.behind}`);
                }
            }
            // Show file stats in Starship-compatible format (!modified +added ✘deleted ?untracked)
            if (gitConfig?.showFileStats && ctx.gitStatus.fileStats) {
                const { modified, added, deleted, untracked } = ctx.gitStatus.fileStats;
                const statParts = [];
                if (modified > 0)
                    statParts.push(`!${modified}`);
                if (added > 0)
                    statParts.push(`+${added}`);
                if (deleted > 0)
                    statParts.push(`✘${deleted}`);
                if (untracked > 0)
                    statParts.push(`?${untracked}`);
                if (statParts.length > 0) {
                    gitParts.push(` ${statParts.join(' ')}`);
                }
            }
            gitPart = ` ${magenta('git:(')}${cyan(gitParts.join(''))}${magenta(')')}`;
        }
        parts.push(`${yellow(projectPath)}${gitPart}`);
    }
    // Config counts (respects environmentThreshold)
    if (display?.showConfigCounts !== false) {
        const totalCounts = ctx.claudeMdCount + ctx.rulesCount + ctx.mcpCount + ctx.hooksCount;
        const envThreshold = display?.environmentThreshold ?? 0;
        if (totalCounts > 0 && totalCounts >= envThreshold) {
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
        }
    }
    // Usage limits display (shown when enabled in config, respects usageThreshold)
    if (display?.showUsage !== false && ctx.usageData?.planName) {
        if (ctx.usageData.apiUnavailable) {
            const errorHint = formatUsageError(ctx.usageData.apiError);
            parts.push(yellow(`usage: ⚠${errorHint}`));
        }
        else if (isLimitReached(ctx.usageData)) {
            const resetTime = ctx.usageData.fiveHour === 100
                ? formatResetTime(ctx.usageData.fiveHourResetAt)
                : formatResetTime(ctx.usageData.sevenDayResetAt);
            parts.push(red(`⚠ Limit reached${resetTime ? ` (resets ${resetTime})` : ''}`));
        }
        else {
            const usageThreshold = display?.usageThreshold ?? 0;
            const fiveHour = ctx.usageData.fiveHour;
            const sevenDay = ctx.usageData.sevenDay;
            const effectiveUsage = Math.max(fiveHour ?? 0, sevenDay ?? 0);
            if (effectiveUsage >= usageThreshold) {
                const fiveHourDisplay = formatUsagePercent(fiveHour);
                const fiveHourReset = formatResetTime(ctx.usageData.fiveHourResetAt);
                const usageBarEnabled = display?.usageBarEnabled ?? true;
                const fiveHourPart = usageBarEnabled
                    ? (fiveHourReset
                        ? `${quotaBar(fiveHour ?? 0)} ${fiveHourDisplay} (${fiveHourReset} / 5h)`
                        : `${quotaBar(fiveHour ?? 0)} ${fiveHourDisplay}`)
                    : (fiveHourReset
                        ? `5h: ${fiveHourDisplay} (${fiveHourReset})`
                        : `5h: ${fiveHourDisplay}`);
                const sevenDayThreshold = display?.sevenDayThreshold ?? 80;
                if (sevenDay !== null && sevenDay >= sevenDayThreshold) {
                    const sevenDayDisplay = formatUsagePercent(sevenDay);
                    const sevenDayReset = formatResetTime(ctx.usageData.sevenDayResetAt);
                    const sevenDayPart = usageBarEnabled
                        ? (sevenDayReset
                            ? `${quotaBar(sevenDay)} ${sevenDayDisplay} (${sevenDayReset} / 7d)`
                            : `${quotaBar(sevenDay)} ${sevenDayDisplay}`)
                        : `7d: ${sevenDayDisplay}`;
                    parts.push(`${fiveHourPart} | ${sevenDayPart}`);
                }
                else {
                    parts.push(fiveHourPart);
                }
            }
        }
    }
    // Session duration
    if (display?.showDuration !== false && ctx.sessionDuration) {
        parts.push(dim(`⏱️  ${ctx.sessionDuration}`));
    }
    if (ctx.extraLabel) {
        parts.push(dim(ctx.extraLabel));
    }
    let line = parts.join(' | ');
    // Token breakdown at high context
    if (display?.showTokenBreakdown !== false && percent >= 85) {
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
function formatContextValue(ctx, percent, mode) {
    if (mode === 'tokens') {
        const totalTokens = getTotalTokens(ctx.stdin);
        const size = ctx.stdin.context_window?.context_window_size ?? 0;
        if (size > 0) {
            return `${formatTokens(totalTokens)}/${formatTokens(size)}`;
        }
        return formatTokens(totalTokens);
    }
    return `${percent}%`;
}
function formatUsagePercent(percent) {
    if (percent === null) {
        return dim('--');
    }
    const color = getContextColor(percent);
    return `${color}${percent}%${RESET}`;
}
function formatUsageError(error) {
    if (!error)
        return '';
    if (error.startsWith('http-')) {
        return ` (${error.slice(5)})`;
    }
    return ` (${error})`;
}
function formatResetTime(resetAt) {
    if (!resetAt)
        return '';
    const now = new Date();
    const diffMs = resetAt.getTime() - now.getTime();
    if (diffMs <= 0)
        return '';
    const diffMins = Math.ceil(diffMs / 60000);
    if (diffMins < 60)
        return `${diffMins}m`;
    const hours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}
//# sourceMappingURL=session-line.js.map