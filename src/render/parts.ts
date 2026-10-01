import type { FirstLineSegment, PathLevels } from '../config.js';
import { DEFAULT_CONFIG } from '../config.js';
import { formatAuthSegment } from '../auth.js';
import { formatUsd } from '../cost.js';
import { formatModelName, getProviderLabel, resolveModelName } from '../stdin.js';
import { t } from '../i18n/index.js';
import { formatTokens } from '../utils/format.js';
import { getFileHref, safeHyperlink } from '../utils/hyperlinks.js';
import { sanitizeDisplayText } from '../utils/sanitize.js';
import type { Frame, Layout } from './frame.js';
import { custom, dim, label, model as modelColor, project as projectColor } from './colors.js';
import { claudeCodeVersion, effort, sessionCostUsd, sessionDuration, sessionName } from './derive.js';
import { vcsPart } from './vcs.js';

/** A first-line part; `key` lets projectLineOrder move it, null keeps its slot. */
export interface Part {
  key: FirstLineSegment | null;
  text: string;
}

function effortSuffix(f: Frame): string {
  const display = f.config?.display;
  const info = display?.showEffortLevel ? effort(f) : null;
  if (!info) return '';
  // The symbol alone can't carry the ultracode marker, so symbol mode keeps the full form.
  if (display?.effortFormat === 'symbol' && info.symbol && !info.level.startsWith('ultracode(')) return ` ${info.symbol}`;
  return display?.effortFormat === 'text' || !info.symbol ? ` ${info.level}` : ` ${info.symbol} ${info.level}`;
}

/** `[Opus 5.5 ◑ high | Bedrock]`, or with the provider first when showProvider is on. */
export function modelBadge(f: Frame): string {
  const display = f.config?.display;
  const name = sanitizeDisplayText(formatModelName(resolveModelName(f.stdin, f.transcript, display?.modelSource), display?.modelFormat, display?.modelOverride));
  const core = `${name}${effortSuffix(f)}`;
  const provider = getProviderLabel(f.stdin);
  let text = provider ? `${core} | ${provider}` : core;
  if (display?.showProvider) {
    const shown = display.providerName?.trim() || provider;
    text = shown ? `${shown} | ${core}` : core;
  }
  return modelColor(`[${text}]`, f.config?.colors);
}

/** An untrusted cwd shown with the configured number of trailing segments, on POSIX and Windows. */
function formatProjectPath(cwd: string, pathLevels: PathLevels): string {
  const safe = sanitizeDisplayText(cwd);
  const segments = safe.split(/[/\\]/).filter(Boolean);
  if (pathLevels !== 'full') {
    return segments.slice(-pathLevels).join('/') || (/^[/\\]/.test(safe) ? '/' : safe);
  }
  if (/^[\\/]{2}/.test(safe)) return segments.length > 0 ? `//${segments.join('/')}` : '//';
  if (/^[A-Za-z]:[\\/]/.test(safe)) return segments.length === 1 ? `${segments[0]}/` : segments.join('/');
  if (/^[\\/]/.test(safe)) return segments.length > 0 ? `/${segments.join('/')}` : '/';
  return segments.join('/') || safe;
}

const MAX_ADDED_DIRS = 5;
const ADDED_DIR_NAME_MAX = 24;

function addedDirNames(f: Frame): Array<{ dir: string; name: string }> {
  const dirs = f.stdin.workspace?.added_dirs;
  if (!Array.isArray(dirs)) return [];
  return dirs
    .filter((dir): dir is string => typeof dir === 'string' && dir.length > 0)
    .map((dir) => {
      const segments = dir.split(/[/\\]/).filter(Boolean);
      const name = sanitizeDisplayText(segments[segments.length - 1] ?? dir);
      return { dir, name: name.length > ADDED_DIR_NAME_MAX ? `${name.slice(0, ADDED_DIR_NAME_MAX - 1)}…` : name };
    })
    .filter(({ name }) => name.length > 0);
}

/** Linked added-dir names, capped at five; `prefix` is the inline `+`. */
export function addedDirs(f: Frame, prefix: string, joiner: string): string | null {
  const dirs = addedDirNames(f);
  if (dirs.length === 0) return null;
  const shown = dirs.slice(0, MAX_ADDED_DIRS).map(({ dir, name }) => safeHyperlink(getFileHref(dir), dim(`${prefix}${name}`)));
  if (dirs.length > MAX_ADDED_DIRS) shown.push(dim(`+${dirs.length - MAX_ADDED_DIRS} more`));
  return shown.join(joiner);
}

/**
 * The project path with its VCS segment, as one part or, with
 * branchOverflow "wrap", two. Expanded links the path and inlines added dirs.
 */
export function projectParts(f: Frame, layout: Layout): string[] {
  const display = f.config?.display;
  const colors = f.config?.colors;
  let project: string | null = null;
  if (display?.showProject !== false && f.stdin.cwd) {
    const text = projectColor(formatProjectPath(f.stdin.cwd, f.config?.pathLevels ?? 1), colors);
    project = layout === 'expanded' ? safeHyperlink(getFileHref(f.stdin.cwd), text) : text;
  }
  if (layout === 'expanded' && display?.showAddedDirs !== false && (display?.addedDirsLayout ?? 'inline') === 'inline') {
    const dirs = addedDirs(f, '+', ' ');
    if (dirs) project = project ? `${project} ${dirs}` : dirs;
  }

  const vcs = vcsPart(f, layout);
  if (project && vcs) {
    const overflow = f.config.gitStatus?.branchOverflow ?? DEFAULT_CONFIG.gitStatus.branchOverflow;
    return overflow === 'wrap' ? [project, vcs] : [`${project} ${vcs}`];
  }
  return [project ?? vcs].filter((part): part is string => !!part);
}

const ADVISOR_MAX_LENGTH = 64;
const ADVISOR_ID = /^(?:claude-)?(opus|sonnet|haiku)-(\d+)-(\d+)/i;

const capitalize = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

/** `claude-opus-4-7` → `Opus 4.7`; aliases like `opus` → `Opus`. */
function prettifyAdvisorId(rawId: string): string {
  const id = rawId.trim();
  const match = id.match(ADVISOR_ID);
  if (match) return `${capitalize(match[1])} ${match[2]}.${match[3]}`;
  if (/^(opus|sonnet|haiku)$/i.test(id)) return capitalize(id);
  return id.replace(/^claude-/i, '');
}

export function advisorPart(f: Frame): string | null {
  const display = f.config?.display;
  if (display?.showAdvisor !== true) return null;
  const clean = (value: unknown): string => (typeof value === 'string' ? sanitizeDisplayText(value.trim()).slice(0, ADVISOR_MAX_LENGTH) : '');
  const override = clean(display.advisorOverride);
  const name = override || clean(prettifyAdvisorId(clean(f.transcript?.advisorModel)));
  return name ? `${label(`${t('label.advisor')}:`, f.config?.colors)} ${name}` : null;
}

const labeled = (f: Frame, text: string | null | undefined): string | null => (text ? label(text, f.config?.colors) : null);

export function sessionNamePart(f: Frame): string | null {
  return f.config?.display?.showSessionName ? labeled(f, sessionName(f)) : null;
}

export function versionPart(f: Frame): string | null {
  const version = f.config?.display?.showClaudeCodeVersion ? claudeCodeVersion(f) : undefined;
  return labeled(f, version && `CC v${version}`);
}

export function durationPart(f: Frame): string | null {
  const duration = f.config?.display?.showDuration === true ? sessionDuration(f) : '';
  return labeled(f, duration && `⏱️  ${duration}`);
}

export function extraPart(f: Frame): string | null {
  return labeled(f, f.extraLabel);
}

/** `Cost $1.23 | Today $4.56 | Week $12.00`, one dim span. */
export function costPart(f: Frame): string | null {
  const display = f.config?.display;
  const costUsd = display?.showCost === true ? sessionCostUsd(f) : null;
  const parts = [
    costUsd !== null ? `${t('label.cost')} ${formatUsd(costUsd)}` : null,
    display?.showDailyCost === true && f.costTotals ? `${t('label.today')} ${formatUsd(f.costTotals.todayUsd)}` : null,
    display?.showWeeklyCost === true && f.costTotals?.weekUsd != null ? `${t('label.week')} ${formatUsd(f.costTotals.weekUsd)}` : null,
  ].filter(Boolean);
  return labeled(f, parts.join(' | '));
}

export function speedPart(f: Frame): string | null {
  if (!f.config?.display?.showSpeed || f.outputSpeed === null) return null;
  return labeled(f, `${t('format.out')}: ${f.outputSpeed.toFixed(1)} ${t('format.tokPerSec')}`);
}

export function authPart(f: Frame): string | null {
  return labeled(f, formatAuthSegment(f.authInfo, f.config?.display));
}

export function customLinePart(f: Frame, position: 'first' | 'last'): string | null {
  const display = f.config?.display;
  if (!display?.customLine || (display.customLinePosition ?? 'last') !== position) return null;
  return custom(display.customLine, f.config?.colors);
}

/** `2 CLAUDE.md`, `3 rules`, `4 MCPs`, `1 hooks`, once their total reaches environmentThreshold. */
export function configCountParts(f: Frame, mcpSuffix = ''): string[] {
  const display = f.config?.display;
  const total = f.claudeMdCount + f.rulesCount + f.mcpCount + f.hooksCount;
  if (display?.showConfigCounts !== true || total === 0 || total < (display?.environmentThreshold ?? 0)) return [];
  const colors = f.config?.colors;
  return [
    f.claudeMdCount > 0 ? label(`${f.claudeMdCount} CLAUDE.md`, colors) : null,
    f.rulesCount > 0 ? label(`${f.rulesCount} ${t('label.rules')}`, colors) : null,
    f.mcpCount > 0 ? `${label(`${f.mcpCount} MCPs`, colors)}${mcpSuffix}` : null,
    f.hooksCount > 0 ? label(`${f.hooksCount} ${t('label.hooks')}`, colors) : null,
  ].filter((part): part is string => part !== null);
}

/** `Tokens 262k (in: 6k, out: 2k, cache: 254k)` from the transcript's session totals. */
export function sessionTokensSummary(f: Frame, prefix: string): string | null {
  const tokens = f.transcript.sessionTokens;
  if (!tokens) return null;
  const total = tokens.inputTokens + tokens.outputTokens + tokens.cacheCreationTokens + tokens.cacheReadTokens;
  if (total === 0) return null;
  const parts = [`${t('format.in')}: ${formatTokens(tokens.inputTokens)}`, `${t('format.out')}: ${formatTokens(tokens.outputTokens)}`];
  const cache = tokens.cacheCreationTokens + tokens.cacheReadTokens;
  if (cache > 0) parts.push(`${t('format.cache')}: ${formatTokens(cache)}`);
  return label(`${prefix} ${formatTokens(total)} (${parts.join(', ')})`, f.config?.colors);
}

export function compactionsPart(f: Frame): string | null {
  const count = f.transcript.compactionCount ?? 0;
  return f.config?.display?.showCompactions === true && count > 0 ? label(`${t('label.compactions')}: ${count}`, f.config?.colors) : null;
}
