import type { RenderContext } from '../types.js';
import { isLimitReached } from '../types.js';
import { getContextPercent, getModelName } from '../stdin.js';
import { coloredBar, cyan, dim, magenta, red, yellow, getContextColor, RESET } from './colors.js';

/**
 * Renders the full session line (model + context bar + project + git + counts + usage + duration).
 * Used for default and separators layouts.
 */
export function renderSessionLine(ctx: RenderContext): string {
  const model = getModelName(ctx.stdin);
  const percent = getContextPercent(ctx.stdin);
  const bar = coloredBar(percent);

  const parts: string[] = [];
  const display = ctx.config?.display;

  // Model and context bar (FIRST)
  // Plan name only shows if showUsage is enabled (respects hybrid toggle)
  const showPlanName = display?.showUsage !== false && ctx.usageData?.planName;

  if (display?.showModel !== false && display?.showContextBar !== false) {
    const modelDisplay = showPlanName ? `${model} | ${ctx.usageData!.planName}` : model;
    parts.push(`${cyan(`[${modelDisplay}]`)} ${bar} ${getContextColor(percent)}${percent}%${RESET}`);
  } else if (display?.showModel !== false) {
    const modelDisplay = showPlanName ? `${model} | ${ctx.usageData!.planName}` : model;
    parts.push(`${cyan(`[${modelDisplay}]`)} ${getContextColor(percent)}${percent}%${RESET}`);
  } else if (display?.showContextBar !== false) {
    parts.push(`${bar} ${getContextColor(percent)}${percent}%${RESET}`);
  } else {
    parts.push(`${getContextColor(percent)}${percent}%${RESET}`);
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
      const gitParts: string[] = [ctx.gitStatus.branch];

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

      gitPart = ` ${magenta('git:(')}${cyan(gitParts.join(''))}${magenta(')')}`;
    }

    parts.push(`${yellow(projectPath)}${gitPart}`);
  }

  // Config counts
  if (display?.showConfigCounts !== false) {
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

  // Usage limits display (requires both env var opt-in AND config enabled)
  if (display?.showUsage !== false && ctx.usageData?.planName) {
    if (ctx.usageData.apiUnavailable) {
      parts.push(yellow(`usage: ⚠`));
    } else if (isLimitReached(ctx.usageData)) {
      const resetTime = ctx.usageData.fiveHour === 100
        ? formatResetTime(ctx.usageData.fiveHourResetAt)
        : formatResetTime(ctx.usageData.sevenDayResetAt);
      parts.push(red(`⚠ Limit reached${resetTime ? ` (resets ${resetTime})` : ''}`));
    } else {
      const fiveHourDisplay = formatUsagePercent(ctx.usageData.fiveHour);
      const fiveHourReset = formatResetTime(ctx.usageData.fiveHourResetAt);
      const fiveHourPart = fiveHourReset
        ? `5h: ${fiveHourDisplay} (${fiveHourReset})`
        : `5h: ${fiveHourDisplay}`;

      const sevenDay = ctx.usageData.sevenDay;
      if (sevenDay !== null && sevenDay >= 80) {
        const sevenDayDisplay = formatUsagePercent(sevenDay);
        parts.push(`${fiveHourPart} | 7d: ${sevenDayDisplay}`);
      } else {
        parts.push(fiveHourPart);
      }
    }
  }

  // Session duration
  if (display?.showDuration !== false && ctx.sessionDuration) {
    parts.push(dim(`⏱️  ${ctx.sessionDuration}`));
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

function formatTokens(n: number): string {
  if (n >= 1000000) {
    return `${(n / 1000000).toFixed(1)}M`;
  }
  if (n >= 1000) {
    return `${(n / 1000).toFixed(0)}k`;
  }
  return n.toString();
}

function formatUsagePercent(percent: number | null): string {
  if (percent === null) {
    return dim('--');
  }
  const color = getContextColor(percent);
  return `${color}${percent}%${RESET}`;
}

function formatResetTime(resetAt: Date | null): string {
  if (!resetAt) return '';
  const now = new Date();
  const diffMs = resetAt.getTime() - now.getTime();
  if (diffMs <= 0) return '';

  const diffMins = Math.ceil(diffMs / 60000);
  if (diffMins < 60) return `${diffMins}m`;

  const hours = Math.floor(diffMins / 60);
  const mins = diffMins % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}
