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
import { DEFAULT_PROJECT_LINE_ORDER } from '../config.js';
import type { FirstLineSegment } from '../config.js';
import { orderFirstLineParts } from './first-line-order.js';
import type { FirstLinePart } from './first-line-order.js';

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

  const parts: FirstLinePart[] = [];
  const push = (text: string, key: FirstLineSegment | null = null) => parts.push({ key, text });
  const timeFormat: TimeFormatMode = display?.timeFormat ?? 'relative';
  const resetsKey = timeFormat === 'absolute' ? 'format.resets' : 'format.resetsIn';
  const contextValueMode = display?.contextValue ?? 'percent';
  const contextValue = formatContextValue(ctx, percent, contextValueMode);
  const contextValueDisplay = `${getContextColor(percent, colors, contextThresholds)}${contextValue}${RESET}`;

  const customLine = display?.customLine;
  const customLinePosition = display?.customLinePosition ?? 'last';
  if (customLine && customLinePosition === 'first') {
    push(customColor(customLine, colors));
  }

  // Model and context bar
  const modelDisplay = formatModelDisplay(model, ctx);

  // The compact layout keeps the context bar attached to the model badge, so
  // the whole cluster reorders as the coarse 'model' segment.
  if (display?.showModel !== false && display?.showContextBar !== false) {
    push(`${modelColor(`[${modelDisplay}]`, colors)} ${bar} ${contextValueDisplay}`, 'model');
  } else if (display?.showModel !== false) {
    push(`${modelColor(`[${modelDisplay}]`, colors)} ${contextValueDisplay}`, 'model');
  } else if (display?.showContextBar !== false) {
    push(`${bar} ${contextValueDisplay}`, 'model');
  } else {
    push(contextValueDisplay, 'model');
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
      push(projectPart, 'project');
      push(gitPart, 'project');
    } else {
      push(`${projectPart} ${gitPart}`, 'project');
    }
  } else if (projectPart) {
    push(projectPart, 'project');
  } else if (gitPart) {
    push(gitPart, 'project');
  }

  // Session name (custom title from /rename, or auto-generated slug)
  if (display?.showSessionName && ctx.transcript.sessionName) {
    push(label(ctx.transcript.sessionName, colors), 'sessionName');
  }

  if (display?.showClaudeCodeVersion && ctx.claudeCodeVersion) {
    push(label(`CC v${ctx.claudeCodeVersion}`, colors), 'version');
  }

  // Config counts (respects environmentThreshold)
  if (display?.showConfigCounts === true) {
    const totalCounts = ctx.claudeMdCount + ctx.rulesCount + ctx.mcpCount + ctx.hooksCount;
    const envThreshold = display?.environmentThreshold ?? 0;

    if (totalCounts > 0 && totalCounts >= envThreshold) {
      if (ctx.claudeMdCount > 0) {
        push(label(`${ctx.claudeMdCount} CLAUDE.md`, colors));
      }

      if (ctx.rulesCount > 0) {
        push(label(`${ctx.rulesCount} ${t('label.rules')}`, colors));
      }

      if (ctx.mcpCount > 0) {
        push(label(`${ctx.mcpCount} MCPs`, colors));
      }

      if (ctx.hooksCount > 0) {
        push(label(`${ctx.hooksCount} ${t('label.hooks')}`, colors));
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
        push(critical(`⚠ Limit${resetTime ? ` (${resetTime})` : ''}`, colors));
      } else {
        const resetSuffix = resetTime
          ? showResetLabel
            ? ` (${t(resetsKey)} ${resetTime})`
            : ` (${resetTime})`
          : '';
        push(critical(`⚠ ${t('status.limitReached')}${resetSuffix}`, colors));
      }
      scopedParts.forEach((part) => push(part));
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
            push(fiveHourPart);
            push(sevenDayPart);
          } else if (fiveHourPart) {
            push(fiveHourPart);
          } else if (sevenDayPart) {
            push(sevenDayPart);
          }
          scopedParts.forEach((part) => push(part));
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
          push(weeklyOnlyPart);
          scopedParts.forEach((part) => push(part));
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
            push(`${label(t('label.usage'), colors)} ${fiveHourPart}`);
            push(sevenDayPart);
          } else {
            push(`${label(t('label.usage'), colors)} ${fiveHourPart}`);
          }
          scopedParts.forEach((part) => push(part));
        } else if (scopedParts.length > 0) {
          const [firstScopedPart, ...remainingScopedParts] = scopedParts;
          push(`${label(t('label.usage'), colors)} ${firstScopedPart}`);
          remainingScopedParts.forEach((part) => push(part));
        }
      }
    }

    if (ctx.usageData.balanceLabel) {
      if (!hasWindowData) {
        push(`${label(t('label.usage'), colors)} ${ctx.usageData.balanceLabel}`);
      } else {
        push(ctx.usageData.balanceLabel);
      }
    }
  }

  // Session token usage (cumulative)
  if (display?.showSessionTokens && ctx.transcript.sessionTokens) {
    const summary = formatSessionTokenSummary(ctx.transcript.sessionTokens, `${t('format.tok')}:`);
    if (summary) {
      push(label(summary, colors));
    }
  }

  // Compaction count from transcript compact_boundary entries (opt-in,
  // hidden until the first compaction)
  if (display?.showCompactions) {
    const compactions = ctx.transcript.compactionCount ?? 0;
    if (compactions > 0) {
      push(label(`${t('label.compactions')}: ${compactions}`, colors));
    }
  }

  // Advisor model (when `/advisor` is configured for the session)
  if (display?.showAdvisor) {
    const advisorLine = renderAdvisorLine(ctx);
    if (advisorLine) {
      push(advisorLine, 'advisor');
    }
  }

  if (display?.showDuration === true && ctx.sessionDuration) {
    push(label(`⏱️  ${ctx.sessionDuration}`, colors), 'duration');
  }

  const sessionTimeLine = renderSessionTimeLine(ctx);
  if (sessionTimeLine) {
    push(sessionTimeLine);
  }

  const promptCacheLine = renderPromptCacheLine(ctx);
  if (promptCacheLine) {
    push(promptCacheLine);
  }

  const costEstimate = renderCostEstimate(ctx);
  if (costEstimate) {
    push(costEstimate, 'cost');
  }

  if (display?.showSpeed) {
    const speed = getOutputSpeed(ctx.stdin);
    if (speed !== null) {
      push(label(`${t('format.out')}: ${speed.toFixed(1)} ${t('format.tokPerSec')}`, colors), 'speed');
    }
  }

  if (ctx.extraLabel) {
    push(label(ctx.extraLabel, colors), 'extra');
  }

  const authSegment = formatAuthSegment(ctx.authInfo, display);
  if (authSegment) {
    push(label(authSegment, colors), 'auth');
  }

  if (customLine && customLinePosition === 'last') {
    push(customColor(customLine, colors));
  }

  const order = ctx.config?.projectLineOrder ?? DEFAULT_PROJECT_LINE_ORDER;
  let line = orderFirstLineParts(parts, order).join(' | ');

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
