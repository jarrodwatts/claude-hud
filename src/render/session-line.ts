import type { RenderContext } from '../types.js';
import { isLimitReached } from '../types.js';
import { getContextPercent, getBufferedPercent, getModelName, getProviderLabel, getTotalTokens } from '../stdin.js';
import { getOutputSpeed } from '../speed-tracker.js';
import { coloredBar, cyan, dim, magenta, red, yellow, getContextColor, quotaBar, RESET, visualLength } from './colors.js';

const DEBUG = process.env.DEBUG?.includes('claude-hud') || process.env.DEBUG === '*';

/** Separator between parts */
const SEP = ' | ';
const SEP_LEN = 3; // visual length of ' | '

/**
 * Renders the full session line (model + context bar + project + git + counts + usage + duration).
 * Used for compact layout mode. Width-aware: progressively drops sections to fit.
 *
 * @param maxWidth - Available terminal width. Sections are dropped right-to-left when overflowing.
 */
export function renderSessionLine(ctx: RenderContext, maxWidth: number = 120): string {
  const model = getModelName(ctx.stdin);

  const rawPercent = getContextPercent(ctx.stdin);
  const bufferedPercent = getBufferedPercent(ctx.stdin);
  const autocompactMode = ctx.config?.display?.autocompactBuffer ?? 'enabled';
  const percent = autocompactMode === 'disabled' ? rawPercent : bufferedPercent;

  if (DEBUG && autocompactMode === 'disabled') {
    console.error(`[claude-hud:context] autocompactBuffer=disabled, showing raw ${rawPercent}% (buffered would be ${bufferedPercent}%)`);
  }

  const display = ctx.config?.display;
  const providerLabel = getProviderLabel(ctx.stdin);

  // Build all candidate sections in priority order (first = highest priority, dropped last)
  // Each section is a { key, render } where render returns the string part.
  // We assemble from high→low priority and drop from the tail when overflowing.
  const sections = buildSections(ctx, { model, percent, display, providerLabel });

  // Progressive fit: try all sections, drop lowest-priority ones until it fits
  return fitSections(sections, maxWidth);
}

interface SectionContext {
  model: string;
  percent: number;
  display: RenderContext['config']['display'];
  providerLabel: string | null;
}

interface Section {
  key: string;
  content: string;
}

function buildSections(ctx: RenderContext, sc: SectionContext): Section[] {
  const { model, percent, display, providerLabel } = sc;
  const sections: Section[] = [];

  // --- PRIORITY 1: Model + context (always shown) ---
  const contextValueMode = display?.contextValue ?? 'percent';
  const contextValue = formatContextValue(ctx, percent, contextValueMode);
  const contextValueDisplay = `${getContextColor(percent)}${contextValue}${RESET}`;

  const planName = display?.showUsage !== false ? ctx.usageData?.planName : undefined;
  const planDisplay = providerLabel ?? planName;
  const modelDisplay = planDisplay ? `${model} | ${planDisplay}` : model;
  const bar = coloredBar(percent);

  if (display?.showModel !== false && display?.showContextBar !== false) {
    sections.push({ key: 'model', content: `${cyan(`[${modelDisplay}]`)} ${bar} ${contextValueDisplay}` });
  } else if (display?.showModel !== false) {
    sections.push({ key: 'model', content: `${cyan(`[${modelDisplay}]`)} ${contextValueDisplay}` });
  } else if (display?.showContextBar !== false) {
    sections.push({ key: 'model', content: `${bar} ${contextValueDisplay}` });
  } else {
    sections.push({ key: 'model', content: contextValueDisplay });
  }

  // --- PRIORITY 2: Project + git ---
  if (ctx.stdin.cwd) {
    const segments = ctx.stdin.cwd.split(/[/\\]/).filter(Boolean);
    const pathLevels = ctx.config?.pathLevels ?? 1;
    const projectPath = segments.length > 0 ? segments.slice(-pathLevels).join('/') : '/';

    let gitPart = '';
    const gitConfig = ctx.config?.gitStatus;
    const showGit = gitConfig?.enabled ?? true;

    if (showGit && ctx.gitStatus) {
      const gitParts: string[] = [ctx.gitStatus.branch];

      if ((gitConfig?.showDirty ?? true) && ctx.gitStatus.isDirty) {
        gitParts.push('*');
      }

      if (gitConfig?.showAheadBehind) {
        if (ctx.gitStatus.ahead > 0) gitParts.push(` ↑${ctx.gitStatus.ahead}`);
        if (ctx.gitStatus.behind > 0) gitParts.push(` ↓${ctx.gitStatus.behind}`);
      }

      if (gitConfig?.showFileStats && ctx.gitStatus.fileStats) {
        const { modified, added, deleted, untracked } = ctx.gitStatus.fileStats;
        const statParts: string[] = [];
        if (modified > 0) statParts.push(`!${modified}`);
        if (added > 0) statParts.push(`+${added}`);
        if (deleted > 0) statParts.push(`✘${deleted}`);
        if (untracked > 0) statParts.push(`?${untracked}`);
        if (statParts.length > 0) gitParts.push(` ${statParts.join(' ')}`);
      }

      gitPart = ` ${magenta('git:(')}${cyan(gitParts.join(''))}${magenta(')')}`;
    }

    sections.push({ key: 'project', content: `${yellow(projectPath)}${gitPart}` });
  }

  // --- PRIORITY 3: Usage (split into 5h and 7d for independent shedding) ---
  if (display?.showUsage !== false && ctx.usageData?.planName && !providerLabel) {
    const usageParts = buildUsageSections(ctx, display);
    for (const part of usageParts) {
      sections.push(part);
    }
  }

  // --- PRIORITY 4: Config counts (low priority, dropped first) ---
  if (display?.showConfigCounts !== false) {
    const countParts = buildConfigCountParts(ctx, display);
    for (const part of countParts) {
      sections.push({ key: 'config', content: part });
    }
  }

  // --- PRIORITY 5: Speed (optional) ---
  if (display?.showSpeed) {
    const speed = getOutputSpeed(ctx.stdin);
    if (speed !== null) {
      sections.push({ key: 'speed', content: dim(`out: ${speed.toFixed(1)} tok/s`) });
    }
  }

  // --- PRIORITY 6: Duration (optional) ---
  if (display?.showDuration !== false && ctx.sessionDuration) {
    sections.push({ key: 'duration', content: dim(`⏱️  ${ctx.sessionDuration}`) });
  }

  // --- PRIORITY 7: Extra label (lowest) ---
  if (ctx.extraLabel) {
    sections.push({ key: 'extra', content: dim(ctx.extraLabel) });
  }

  // Append token breakdown suffix to model section at high context
  if (display?.showTokenBreakdown !== false && percent >= 85) {
    const usage = ctx.stdin.context_window?.current_usage;
    if (usage && sections.length > 0) {
      const input = formatTokens(usage.input_tokens ?? 0);
      const cache = formatTokens((usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0));
      sections[0].content += dim(` (in: ${input}, cache: ${cache})`);
    }
  }

  return sections;
}

/**
 * Build usage as separate sections (5h and 7d) so they can be independently
 * shed when the terminal is too narrow. 7d drops before 5h.
 */
function buildUsageSections(ctx: RenderContext, display: RenderContext['config']['display']): Section[] {
  if (!ctx.usageData) return [];

  if (ctx.usageData.apiUnavailable) {
    const errorHint = formatUsageError(ctx.usageData.apiError);
    return [{ key: 'usage-5h', content: yellow(`usage: ⚠${errorHint}`) }];
  }

  if (isLimitReached(ctx.usageData)) {
    const resetTime = ctx.usageData.fiveHour === 100
      ? formatResetTime(ctx.usageData.fiveHourResetAt)
      : formatResetTime(ctx.usageData.sevenDayResetAt);
    return [{ key: 'usage-5h', content: red(`⚠ Limit reached${resetTime ? ` (resets ${resetTime})` : ''}`) }];
  }

  const usageThreshold = display?.usageThreshold ?? 0;
  const fiveHour = ctx.usageData.fiveHour;
  const sevenDay = ctx.usageData.sevenDay;
  const effectiveUsage = Math.max(fiveHour ?? 0, sevenDay ?? 0);

  if (effectiveUsage < usageThreshold) return [];

  const fiveHourDisplay = formatUsagePercent(fiveHour);
  const fiveHourReset = formatResetTime(ctx.usageData.fiveHourResetAt);
  const usageBarEnabled = display?.usageBarEnabled ?? true;

  const fiveHourContent = usageBarEnabled
    ? (fiveHourReset
        ? `${quotaBar(fiveHour ?? 0)} ${fiveHourDisplay} (${fiveHourReset} / 5h)`
        : `${quotaBar(fiveHour ?? 0)} ${fiveHourDisplay}`)
    : (fiveHourReset
        ? `5h: ${fiveHourDisplay} (${fiveHourReset})`
        : `5h: ${fiveHourDisplay}`);

  const result: Section[] = [{ key: 'usage-5h', content: fiveHourContent }];

  const sevenDayThreshold = display?.sevenDayThreshold ?? 80;
  if (sevenDay !== null && sevenDay >= sevenDayThreshold) {
    const sevenDayDisplay = formatUsagePercent(sevenDay);
    const sevenDayReset = formatResetTime(ctx.usageData.sevenDayResetAt);
    const sevenDayContent = usageBarEnabled
      ? (sevenDayReset
          ? `${quotaBar(sevenDay)} ${sevenDayDisplay} (${sevenDayReset} / 7d)`
          : `${quotaBar(sevenDay)} ${sevenDayDisplay}`)
      : `7d: ${sevenDayDisplay}`;
    result.push({ key: 'usage-7d', content: sevenDayContent });
  }

  return result;
}

function buildConfigCountParts(ctx: RenderContext, display: RenderContext['config']['display']): string[] {
  const totalCounts = ctx.claudeMdCount + ctx.rulesCount + ctx.mcpCount + ctx.hooksCount;
  const envThreshold = display?.environmentThreshold ?? 0;
  const parts: string[] = [];

  if (totalCounts > 0 && totalCounts >= envThreshold) {
    if (ctx.claudeMdCount > 0) parts.push(dim(`${ctx.claudeMdCount} CLAUDE.md`));
    if (ctx.rulesCount > 0) parts.push(dim(`${ctx.rulesCount} rules`));
    if (ctx.mcpCount > 0) parts.push(dim(`${ctx.mcpCount} MCPs`));
    if (ctx.hooksCount > 0) parts.push(dim(`${ctx.hooksCount} hooks`));
  }

  return parts;
}

/**
 * Join sections with separators, progressively dropping lowest-priority (last) sections
 * until the result fits within maxWidth. The first section (model+context) is never dropped.
 */
function fitSections(sections: Section[], maxWidth: number): string {
  // Try with all sections, then drop from the end
  for (let count = sections.length; count >= 1; count--) {
    const line = sections.slice(0, count).map(s => s.content).join(SEP);
    if (visualLength(line) <= maxWidth) {
      return line;
    }
  }

  // Even the first section alone overflows — return it (will be truncated by caller)
  return sections[0]?.content ?? '';
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

function formatContextValue(ctx: RenderContext, percent: number, mode: 'percent' | 'tokens'): string {
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

function formatUsagePercent(percent: number | null): string {
  if (percent === null) {
    return dim('--');
  }
  const color = getContextColor(percent);
  return `${color}${percent}%${RESET}`;
}

function formatUsageError(error?: string): string {
  if (!error) return '';
  if (error.startsWith('http-')) {
    return ` (${error.slice(5)})`;
  }
  return ` (${error})`;
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
