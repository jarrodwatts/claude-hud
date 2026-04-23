import type { RenderContext } from '../types.js';
import { isLimitReached } from '../types.js';
import { getContextPercent, getBufferedPercent, getModelName, formatModelName, getProviderLabel, getTotalTokens } from '../stdin.js';
import { getOutputSpeed } from '../speed-tracker.js';
import { coloredBar, critical, git as gitColor, gitBranch as gitBranchColor, label, model as modelColor, project as projectColor, getContextColor, getQuotaColor, quotaBar, custom as customColor, RESET } from './colors.js';
import { getAdaptiveBarWidth } from '../utils/terminal.js';
import { renderCostEstimate } from './lines/cost.js';
import { renderPromptCacheLine } from './lines/prompt-cache.js';
import { t } from '../i18n/index.js';
import type { TimeFormatMode } from '../config.js';
import { formatResetTime } from './format-reset-time.js';

const DEBUG = process.env.DEBUG?.includes('claude-hud') || process.env.DEBUG === '*';

/**
 * Renders the full session line (model + context bar + project + git + counts + usage + duration).
 * Used for compact layout mode.
 */
export function renderSessionLine(ctx: RenderContext): string {
  const model = formatModelName(getModelName(ctx.stdin), ctx.config?.display?.modelFormat, ctx.config?.display?.modelOverride);

  const rawPercent = getContextPercent(ctx.stdin);
  const bufferedPercent = getBufferedPercent(ctx.stdin);
  const autocompactMode = ctx.config?.display?.autocompactBuffer ?? 'enabled';
  const percent = autocompactMode === 'disabled' ? rawPercent : bufferedPercent;

  if (DEBUG && autocompactMode === 'disabled') {
    console.error(`[claude-hud:context] autocompactBuffer=disabled, showing raw ${rawPercent}% (buffered would be ${bufferedPercent}%)`);
  }

  const colors = ctx.config?.colors;
  const display = ctx.config?.display;
  const contextThresholds = {
    warning: display?.contextWarningThreshold,
    critical: display?.contextCriticalThreshold,
  };
  const barWidth = getAdaptiveBarWidth();
  const bar = coloredBar(percent, barWidth, colors, contextThresholds);

  const parts: string[] = [];
  const timeFormat: TimeFormatMode = display?.timeFormat ?? 'relative';
  const resetsKey = timeFormat === 'absolute' ? 'format.resets' : 'format.resetsIn';
  const contextValueMode = display?.contextValue ?? 'percent';
  const contextValue = formatContextValue(ctx, percent, contextValueMode);
  const contextValueDisplay = `${getContextColor(percent, colors, contextThresholds)}${contextValue}${RESET}`;

  // Model and context bar (FIRST)
  const providerLabel = getProviderLabel(ctx.stdin);
  const modelQualifier = providerLabel ?? undefined;
  let modelDisplay = modelQualifier ? `${model} | ${modelQualifier}` : model;
  if (ctx.effortLevel && ctx.effortSymbol) {
    modelDisplay += ` ${ctx.effortSymbol}${ctx.effortLevel}`;
  } else if (ctx.effortLevel) {
    modelDisplay += ` ${ctx.effortLevel}`;
  }

  if (display?.showModel !== false && display?.showContextBar !== false) {
    parts.push(`${modelColor(`[${modelDisplay}]`, colors)} ${bar} ${contextValueDisplay}`);
  } else if (display?.showModel !== false) {
    parts.push(`${modelColor(`[${modelDisplay}]`, colors)} ${contextValueDisplay}`);
  } else if (display?.showContextBar !== false) {
    parts.push(`${bar} ${contextValueDisplay}`);
  } else {
    parts.push(contextValueDisplay);
  }

  // Project path + git status (SECOND)
  let projectPart: string | null = null;
  if (display?.showProject !== false && ctx.stdin.cwd) {
    // Split by both Unix (/) and Windows (\) separators for cross-platform support
    const segments = ctx.stdin.cwd.split(/[/\\]/).filter(Boolean);
    const pathLevels = ctx.config?.pathLevels ?? 1;
    // Always join with forward slash for consistent display
    // Handle root path (/) which results in empty segments
    const projectPath = segments.length > 0 ? segments.slice(-pathLevels).join('/') : '/';
    projectPart = projectColor(projectPath, colors);
  }

  let gitPart = '';
  const gitConfig = ctx.config?.gitStatus;
  const showGit = gitConfig?.enabled ?? true;
  const branchOverflow = gitConfig?.branchOverflow ?? 'truncate';

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

    // Show file stats in Starship-compatible format (!modified +added ✘deleted ?untracked)
    if (gitConfig?.showFileStats && ctx.gitStatus.fileStats) {
      const { modified, added, deleted, untracked } = ctx.gitStatus.fileStats;
      const statParts: string[] = [];
      if (modified > 0) statParts.push(`!${modified}`);
      if (added > 0) statParts.push(`+${added}`);
      if (deleted > 0) statParts.push(`✘${deleted}`);
      if (untracked > 0) statParts.push(`?${untracked}`);
      if (statParts.length > 0) {
        gitParts.push(` ${statParts.join(' ')}`);
      }
    }

    gitPart = `${gitColor('git:(', colors)}${gitBranchColor(gitParts.join(''), colors)}${gitColor(')', colors)}`;
  }

  if (projectPart && gitPart) {
    if (branchOverflow === 'wrap') {
      parts.push(projectPart);
      parts.push(gitPart);
    } else {
      parts.push(`${projectPart} ${gitPart}`);
    }
  } else if (projectPart) {
    parts.push(projectPart);
  } else if (gitPart) {
    parts.push(gitPart);
  }

  // Session name (custom title from /rename, or auto-generated slug)
  if (display?.showSessionName && ctx.transcript.sessionName) {
    parts.push(label(ctx.transcript.sessionName, colors));
  }

  if (display?.showClaudeCodeVersion && ctx.claudeCodeVersion) {
    parts.push(label(`CC v${ctx.claudeCodeVersion}`, colors));
  }

  // Config counts (respects environmentThreshold)
  if (display?.showConfigCounts !== false) {
    const totalCounts = ctx.claudeMdCount + ctx.rulesCount + ctx.mcpCount + ctx.hooksCount;
    const envThreshold = display?.environmentThreshold ?? 0;

    if (totalCounts > 0 && totalCounts >= envThreshold) {
      if (ctx.claudeMdCount > 0) {
        parts.push(label(`${ctx.claudeMdCount} CLAUDE.md`, colors));
      }

      if (ctx.rulesCount > 0) {
        parts.push(label(`${ctx.rulesCount} ${t('label.rules')}`, colors));
      }

      if (ctx.mcpCount > 0) {
        parts.push(label(`${ctx.mcpCount} MCPs`, colors));
      }

      if (ctx.hooksCount > 0) {
        parts.push(label(`${ctx.hooksCount} ${t('label.hooks')}`, colors));
      }
    }
  }

  // Usage limits display (shown when enabled in config, respects usageThreshold)
  if (display?.showUsage !== false && ctx.usageData && !providerLabel) {
    const usageCompact = display?.usageCompact ?? false;
    const showResetLabel = display?.showResetLabel ?? true;

    if (isLimitReached(ctx.usageData)) {
      const resetTime = ctx.usageData.fiveHour === 100
        ? formatResetTime(ctx.usageData.fiveHourResetAt, timeFormat)
        : formatResetTime(ctx.usageData.sevenDayResetAt, timeFormat);
      if (usageCompact) {
        parts.push(critical(`⚠ Limit${resetTime ? ` (${resetTime})` : ''}`, colors));
      } else {
        const resetSuffix = resetTime
          ? showResetLabel
            ? ` (${t(resetsKey)} ${resetTime})`
            : ` (${resetTime})`
          : '';
        parts.push(critical(`⚠ ${t('status.limitReached')}${resetSuffix}`, colors));
      }
    } else {
      const usageThreshold = display?.usageThreshold ?? 0;
      const fiveHour = ctx.usageData.fiveHour;
      const sevenDay = ctx.usageData.sevenDay;
      const effectiveUsage = Math.max(fiveHour ?? 0, sevenDay ?? 0);

      if (effectiveUsage >= usageThreshold) {
        const usageBarEnabled = display?.usageBarEnabled ?? true;
        if (usageCompact) {
          const fiveHourPart = fiveHour !== null
            ? formatCompactWindowPart('5h', fiveHour, ctx.usageData.fiveHourResetAt, timeFormat, colors)
            : null;
          const sevenDayThreshold = display?.sevenDayThreshold ?? 80;
          const sevenDayPart = (sevenDay !== null && (fiveHour === null || sevenDay >= sevenDayThreshold))
            ? formatCompactWindowPart('7d', sevenDay, ctx.usageData.sevenDayResetAt, timeFormat, colors)
            : null;

          if (fiveHourPart && sevenDayPart) {
            parts.push(fiveHourPart);
            parts.push(sevenDayPart);
          } else if (fiveHourPart) {
            parts.push(fiveHourPart);
          } else if (sevenDayPart) {
            parts.push(sevenDayPart);
          }
        } else if (fiveHour === null && sevenDay !== null) {
          const weeklyOnlyPart = formatUsageWindowPart({
            label: t('label.weekly'),
            percent: sevenDay,
            resetAt: ctx.usageData.sevenDayResetAt,
            colors,
            usageBarEnabled,
            barWidth,
            timeFormat,
            showResetLabel,
            forceLabel: true,
          });
          parts.push(weeklyOnlyPart);
        } else {
          const fiveHourPart = formatUsageWindowPart({
            label: '5h',
            percent: fiveHour,
            resetAt: ctx.usageData.fiveHourResetAt,
            colors,
            usageBarEnabled,
            barWidth,
            timeFormat,
            showResetLabel,
          });

          const sevenDayThreshold = display?.sevenDayThreshold ?? 80;
          if (sevenDay !== null && sevenDay >= sevenDayThreshold) {
            const sevenDayPart = formatUsageWindowPart({
              label: t('label.weekly'),
              percent: sevenDay,
              resetAt: ctx.usageData.sevenDayResetAt,
              colors,
              usageBarEnabled,
              barWidth,
              timeFormat,
              showResetLabel,
              forceLabel: true,
            });
            parts.push(`${label(t('label.usage'), colors)} ${fiveHourPart}`);
            parts.push(sevenDayPart);
          } else {
            parts.push(`${label(t('label.usage'), colors)} ${fiveHourPart}`);
          }
        }
      }
    }
  }

  // Session token usage (cumulative)
  if (display?.showSessionTokens && ctx.transcript.sessionTokens) {
    const st = ctx.transcript.sessionTokens;
    const total = st.inputTokens + st.outputTokens + st.cacheCreationTokens + st.cacheReadTokens;
    if (total > 0) {
      parts.push(label(`${t('format.tok')}: ${formatTokens(total)} (${t('format.in')}: ${formatTokens(st.inputTokens)}, ${t('format.out')}: ${formatTokens(st.outputTokens)})`, colors));
    }
  }

  if (display?.showDuration !== false && ctx.sessionDuration) {
    parts.push(label(`⏱️  ${ctx.sessionDuration}`, colors));
  }

  const promptCacheLine = renderPromptCacheLine(ctx);
  if (promptCacheLine) {
    parts.push(promptCacheLine);
  }

  const costEstimate = renderCostEstimate(ctx);
  if (costEstimate) {
    parts.push(costEstimate);
  }

  if (display?.showSpeed) {
    const speed = getOutputSpeed(ctx.stdin);
    if (speed !== null) {
      parts.push(label(`${t('format.out')}: ${speed.toFixed(1)} ${t('format.tokPerSec')}`, colors));
    }
  }

  if (ctx.extraLabel) {
    parts.push(label(ctx.extraLabel, colors));
  }

  // Custom line (static user-defined text)
  const customLine = display?.customLine;
  if (customLine) {
    parts.push(customColor(customLine, colors));
  }

  let line = parts.join(' | ');

  // Token breakdown at high context
  if (display?.showTokenBreakdown !== false && percent >= (display?.contextCriticalThreshold ?? 85)) {
    const usage = ctx.stdin.context_window?.current_usage;
    if (usage) {
      const input = formatTokens(usage.input_tokens ?? 0);
      const cache = formatTokens((usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0));
      line += label(` (${t('format.in')}: ${input}, ${t('format.cache')}: ${cache})`, colors);
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

function formatContextValue(ctx: RenderContext, percent: number, mode: 'percent' | 'tokens' | 'remaining' | 'both'): string {
  const totalTokens = getTotalTokens(ctx.stdin);
  const size = ctx.stdin.context_window?.context_window_size ?? 0;

  if (mode === 'tokens') {
    if (size > 0) {
      return `${formatTokens(totalTokens)}/${formatTokens(size)}`;
    }
    return formatTokens(totalTokens);
  }

  if (mode === 'both') {
    if (size > 0) {
      return `${percent}% (${formatTokens(totalTokens)}/${formatTokens(size)})`;
    }
    return `${percent}%`;
  }

  if (mode === 'remaining') {
    return `${Math.max(0, 100 - percent)}%`;
  }

  return `${percent}%`;
}

function formatCompactWindowPart(
  windowLabel: string,
  percent: number | null,
  resetAt: Date | null,
  timeFormat: TimeFormatMode,
  colors?: RenderContext['config']['colors'],
): string {
  const usageDisplay = formatUsagePercent(percent, colors);
  const reset = formatResetTime(resetAt, timeFormat);
  const styledLabel = label(`${windowLabel}:`, colors);
  return reset
    ? `${styledLabel} ${usageDisplay} ${label(`(${reset})`, colors)}`
    : `${styledLabel} ${usageDisplay}`;
}

function formatUsagePercent(percent: number | null, colors?: RenderContext['config']['colors']): string {
  if (percent === null) {
    return label('--', colors);
  }
  const color = getQuotaColor(percent, colors);
  return `${color}${percent}%${RESET}`;
}

function formatUsageWindowPart({
  label: windowLabel,
  percent,
  resetAt,
  colors,
  usageBarEnabled,
  barWidth,
  timeFormat = 'relative',
  showResetLabel,
  forceLabel = false,
}: {
  label: string;
  percent: number | null;
  resetAt: Date | null;
  colors?: RenderContext['config']['colors'];
  usageBarEnabled: boolean;
  barWidth: number;
  timeFormat?: TimeFormatMode;
  showResetLabel: boolean;
  forceLabel?: boolean;
}): string {
  const usageDisplay = formatUsagePercent(percent, colors);
  const reset = formatResetTime(resetAt, timeFormat);
  const styledLabel = label(windowLabel, colors);
  // "resets in X" for relative/both; "resets X" for absolute (avoids "resets in at 14:30")
  const resetsKey = timeFormat === 'absolute' ? 'format.resets' : 'format.resetsIn';

  if (usageBarEnabled) {
    // Relative mode keeps the upstream "(duration / windowLabel)" pattern (e.g. "2h 30m / 5h").
    // Absolute/both modes use the preposition form instead — "(at 14:30 / 5h)" is incoherent.
    const barReset = timeFormat === 'relative'
      ? (reset ? `${reset} / ${windowLabel}` : null)
      : (reset ? (showResetLabel ? `${t(resetsKey)} ${reset}` : reset) : null);
    const body = barReset
      ? `${quotaBar(percent ?? 0, barWidth, colors)} ${usageDisplay} (${barReset})`
      : `${quotaBar(percent ?? 0, barWidth, colors)} ${usageDisplay}`;
    return forceLabel ? `${styledLabel} ${body}` : body;
  }

  const resetSuffix = reset
    ? showResetLabel
      ? `(${t(resetsKey)} ${reset})`
      : `(${reset})`
    : '';

  return resetSuffix
    ? `${styledLabel} ${usageDisplay} ${resetSuffix}`
    : `${styledLabel} ${usageDisplay}`;
}
