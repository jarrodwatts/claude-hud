import type { RenderContext } from '../types.js';
import { isLimitReached } from '../types.js';
import { getContextPercent, getBufferedPercent, getModelName, formatModelName, resolveModelName, shouldHideUsage } from '../stdin.js';
import { getOutputSpeed } from '../speed-tracker.js';
import { coloredBar, critical, git as gitColor, gitBranch as gitBranchColor, label, model as modelColor, project as projectColor, getContextColor, getQuotaColor, quotaBar, custom as customColor, RESET } from './colors.js';
import { getAdaptiveBarWidth } from '../utils/terminal.js';
import { renderCostEstimate } from './lines/cost.js';
import { renderPromptCacheLine } from './lines/prompt-cache.js';
import { renderSessionTimeLine } from './lines/session-time.js';
import { renderAdvisorLine } from './lines/advisor.js';
import { t } from '../i18n/index.js';
import type { TimeFormatMode, UsageValueMode } from '../config.js';
import { formatResetTime } from './format-reset-time.js';
import { formatTokens, formatContextValue } from '../utils/format.js';
import { formatAuthSegment } from '../auth.js';
import { createDebug } from '../debug.js';
import { formatModelDisplay } from './model-display.js';
import { formatSessionTokenSummary } from './lines/session-tokens.js';
import { sanitizeDisplayText } from '../utils/sanitize.js';
import { formatProjectPath } from './project-path.js';

const debug = createDebug('session-line');

/**
 * Renders the full session line (model + context bar + project + git + counts + usage + duration).
 * Used for compact layout mode.
 */
export function renderSessionLine(ctx: RenderContext): string {
  const model = formatModelName(resolveModelName(ctx.stdin, ctx.transcript, ctx.config?.display?.modelSource), ctx.config?.display?.modelFormat, ctx.config?.display?.modelOverride);

  const autoCompactWindow = ctx.config?.display?.autoCompactWindow ?? null;
  const rawPercent = getContextPercent(ctx.stdin, autoCompactWindow);
  const bufferedPercent = getBufferedPercent(ctx.stdin, autoCompactWindow);
  const autocompactMode = ctx.config?.display?.autocompactBuffer ?? 'enabled';
  const percent = autocompactMode === 'disabled' ? rawPercent : bufferedPercent;

  if (autocompactMode === 'disabled') {
    debug(`autocompactBuffer=disabled, showing raw ${rawPercent}% (buffered would be ${bufferedPercent}%)`);
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

  const customLine = display?.customLine;
  const customLinePosition = display?.customLinePosition ?? 'last';
  if (customLine && customLinePosition === 'first') {
    parts.push(customColor(customLine, colors));
  }

  // Model and context bar
  const modelDisplay = formatModelDisplay(model, ctx);

  if (display?.showModel !== false && display?.showContextBar !== false) {
    parts.push(`${modelColor(`[${modelDisplay}]`, colors)} ${bar} ${contextValueDisplay}`);
  } else if (display?.showModel !== false) {
    parts.push(`${modelColor(`[${modelDisplay}]`, colors)} ${contextValueDisplay}`);
  } else if (display?.showContextBar !== false) {
    parts.push(`${bar} ${contextValueDisplay}`);
  } else {
    parts.push(contextValueDisplay);
  }

  // Project path + git status
  let projectPart: string | null = null;
  if (display?.showProject !== false && ctx.stdin.cwd) {
    const pathLevels = ctx.config?.pathLevels ?? 1;
    const projectPath = formatProjectPath(ctx.stdin.cwd, pathLevels);
    projectPart = projectColor(projectPath, colors);
  }

  let gitPart = '';
  const gitConfig = ctx.config?.gitStatus;
  const showGit = gitConfig?.enabled ?? true;
  const branchOverflow = gitConfig?.branchOverflow ?? 'truncate';

  if (showGit && ctx.gitStatus) {
    const gitParts: string[] = [sanitizeDisplayText(ctx.gitStatus.branch)];

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
  if (display?.showConfigCounts === true) {
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
  if (display?.showUsage !== false && ctx.usageData && !shouldHideUsage(ctx.stdin)) {
    const usageCompact = display?.usageCompact ?? false;
    const showResetLabel = display?.showResetLabel ?? true;
    const usageValueMode = display?.usageValue ?? 'percent';
    const scopedWindows = ctx.usageData.scopedWindows ?? [];
    const hasGenericWindowData = ctx.usageData.fiveHour !== null || ctx.usageData.sevenDay !== null;
    const hasWindowData = hasGenericWindowData || scopedWindows.length > 0;
    const scopedParts = scopedWindows.map((window) =>
      usageCompact
        ? formatCompactWindowPart(
            window.label,
            window.percent,
            window.resetAt,
            timeFormat,
            colors,
            usageValueMode,
          )
        : formatUsageWindowPart({
            label: window.label,
            percent: window.percent,
            resetAt: window.resetAt,
            colors,
            usageBarEnabled: display?.usageBarEnabled ?? true,
            barWidth,
            timeFormat,
            showResetLabel,
            forceLabel: true,
            usageValueMode,
            windowDurationLabel: '7d',
          }),
    );

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
      parts.push(...scopedParts);
    } else {
      const usageThreshold = display?.usageThreshold ?? 0;
      const fiveHour = ctx.usageData.fiveHour;
      const sevenDay = ctx.usageData.sevenDay;
      const effectiveUsage = Math.max(
        fiveHour ?? 0,
        sevenDay ?? 0,
        ...scopedWindows.map((window) => window.percent ?? 0),
      );

      if ((hasWindowData || !ctx.usageData.balanceLabel) && effectiveUsage >= usageThreshold) {
        const usageBarEnabled = display?.usageBarEnabled ?? true;
        if (usageCompact) {
          const fiveHourPart = fiveHour !== null
            ? formatCompactWindowPart('5h', fiveHour, ctx.usageData.fiveHourResetAt, timeFormat, colors, usageValueMode)
            : null;
          const sevenDayThreshold = display?.sevenDayThreshold ?? 80;
          const sevenDayPart = (sevenDay !== null && (fiveHour === null || sevenDay >= sevenDayThreshold))
            ? formatCompactWindowPart('7d', sevenDay, ctx.usageData.sevenDayResetAt, timeFormat, colors, usageValueMode)
            : null;

          if (fiveHourPart && sevenDayPart) {
            parts.push(fiveHourPart);
            parts.push(sevenDayPart);
          } else if (fiveHourPart) {
            parts.push(fiveHourPart);
          } else if (sevenDayPart) {
            parts.push(sevenDayPart);
          }
          parts.push(...scopedParts);
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
            usageValueMode,
          });
          parts.push(weeklyOnlyPart);
          parts.push(...scopedParts);
        } else if (hasGenericWindowData || !hasWindowData) {
          const fiveHourPart = formatUsageWindowPart({
            label: '5h',
            percent: fiveHour,
            resetAt: ctx.usageData.fiveHourResetAt,
            colors,
            usageBarEnabled,
            barWidth,
            timeFormat,
            showResetLabel,
            usageValueMode,
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
              usageValueMode,
            });
            parts.push(`${label(t('label.usage'), colors)} ${fiveHourPart}`);
            parts.push(sevenDayPart);
          } else {
            parts.push(`${label(t('label.usage'), colors)} ${fiveHourPart}`);
          }
          parts.push(...scopedParts);
        } else if (scopedParts.length > 0) {
          const [firstScopedPart, ...remainingScopedParts] = scopedParts;
          parts.push(`${label(t('label.usage'), colors)} ${firstScopedPart}`);
          parts.push(...remainingScopedParts);
        }
      }
    }

    if (ctx.usageData.balanceLabel) {
      if (!hasWindowData) {
        parts.push(`${label(t('label.usage'), colors)} ${ctx.usageData.balanceLabel}`);
      } else {
        parts.push(ctx.usageData.balanceLabel);
      }
    }
  }

  // Session token usage (cumulative)
  if (display?.showSessionTokens && ctx.transcript.sessionTokens) {
    const summary = formatSessionTokenSummary(ctx.transcript.sessionTokens, `${t('format.tok')}:`);
    if (summary) {
      parts.push(label(summary, colors));
    }
  }

  // Compaction count from transcript compact_boundary entries (opt-in,
  // hidden until the first compaction)
  if (display?.showCompactions) {
    const compactions = ctx.transcript.compactionCount ?? 0;
    if (compactions > 0) {
      parts.push(label(`${t('label.compactions')}: ${compactions}`, colors));
    }
  }

  // Advisor model (when `/advisor` is configured for the session)
  if (display?.showAdvisor) {
    const advisorLine = renderAdvisorLine(ctx);
    if (advisorLine) {
      parts.push(advisorLine);
    }
  }

  if (display?.showDuration === true && ctx.sessionDuration) {
    parts.push(label(`⏱️  ${ctx.sessionDuration}`, colors));
  }

  const sessionTimeLine = renderSessionTimeLine(ctx);
  if (sessionTimeLine) {
    parts.push(sessionTimeLine);
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

  const authSegment = formatAuthSegment(ctx.authInfo, display);
  if (authSegment) {
    parts.push(label(authSegment, colors));
  }

  if (customLine && customLinePosition === 'last') {
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

function formatCompactWindowPart(
  windowLabel: string,
  percent: number | null,
  resetAt: Date | null,
  timeFormat: TimeFormatMode,
  colors?: RenderContext['config']['colors'],
  usageValueMode: UsageValueMode = 'percent',
): string {
  const usageDisplay = formatUsagePercent(percent, colors, usageValueMode);
  const reset = formatResetTime(resetAt, timeFormat);
  const styledLabel = label(`${windowLabel}:`, colors);
  return reset
    ? `${styledLabel} ${usageDisplay} ${label(`(${reset})`, colors)}`
    : `${styledLabel} ${usageDisplay}`;
}

function formatUsagePercent(
  percent: number | null,
  colors?: RenderContext['config']['colors'],
  mode: UsageValueMode = 'percent',
): string {
  if (percent === null) {
    return label('--', colors);
  }
  const color = getQuotaColor(percent, colors);
  const displayPercent = mode === 'remaining' ? Math.max(0, 100 - percent) : percent;
  return `${color}${displayPercent}%${RESET}`;
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
  usageValueMode = 'percent',
  windowDurationLabel,
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
  usageValueMode?: UsageValueMode;
  windowDurationLabel?: string;
}): string {
  const usageDisplay = formatUsagePercent(percent, colors, usageValueMode);
  const reset = formatResetTime(resetAt, timeFormat);
  const styledLabel = label(windowLabel, colors);
  // "resets in X" for relative/both; "resets X" for absolute (avoids "resets in at 14:30")
  const resetsKey = timeFormat === 'absolute' ? 'format.resets' : 'format.resetsIn';

  if (usageBarEnabled) {
    // Relative mode keeps the upstream "(duration / windowLabel)" pattern (e.g. "2h 30m / 5h").
    // Absolute/both modes use the preposition form instead — "(at 14:30 / 5h)" is incoherent.
    const barReset = timeFormat === 'relative'
      ? (reset ? `${reset} / ${windowDurationLabel ?? windowLabel}` : null)
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
