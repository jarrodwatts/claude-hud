import { formatBytes } from '../memory.js';
import { t } from '../i18n/index.js';
import { sanitizeDisplayText } from '../utils/sanitize.js';
import type { Frame } from './frame.js';
import { critical, dim, getContextColor, getQuotaColor, label, quotaBar, RESET, warning } from './colors.js';
import { outputStyle } from './derive.js';
import { barLabel, type LabelAlign } from './labels.js';
import { addedDirs, configCountParts } from './parts.js';
import { formatAbsoluteTime, formatAgo, wallClock } from './time.js';

const MAX_NAMED_MCP_ERRORS = 3;

/** `⚠ github, tenable +2`. */
function mcpErrors(f: Frame, names: string[]): string {
  const safe = names.map((name) => sanitizeDisplayText(name).trim().slice(0, 64)).filter(Boolean);
  const overflow = safe.length > MAX_NAMED_MCP_ERRORS ? ` +${safe.length - MAX_NAMED_MCP_ERRORS}` : '';
  return critical(`⚠ ${safe.slice(0, MAX_NAMED_MCP_ERRORS).join(', ')}${overflow}`, f.config?.colors);
}

/** Config counts, output style, and failing MCP servers. */
export function environmentLine(f: Frame): string | null {
  const display = f.config?.display;
  const showErrors = display?.showConfigCounts === true || display?.showMcp === true;
  const failing = showErrors ? f.transcript?.mcpErrors ?? [] : [];
  const errors = failing.length > 0 ? mcpErrors(f, failing) : '';
  const parts = configCountParts(f, errors ? ` ${errors}` : '');
  const countedMcp = parts.length > 0 && f.mcpCount > 0;
  const style = display?.showOutputStyle === true ? outputStyle(f) : undefined;
  if (style) parts.push(label(`style: ${style}`, f.config?.colors));
  if (errors && !countedMcp) parts.push(errors);
  return parts.length > 0 ? parts.join(' | ') : null;
}

const TTL_SECONDS: Record<string, number> = { '5m': 300, '1h': 3600 };

// Shows the expiry time rather than a countdown: between turns, exactly when the cache
// drains, the statusline isn't repainted and a countdown would freeze.
export function promptCacheLine(f: Frame): string | null {
  const display = f.config?.display;
  const cache = f.stdin.prompt_cache;
  if (!display?.showPromptCache || !cache?.caching_observed) return null;

  const colors = f.config?.colors;
  const expiresAtMs = typeof cache.expires_at === 'number' ? cache.expires_at * 1000 : 0;
  const remainingMs = cache.warm ? expiresAtMs - f.now : 0;
  let value: string;
  if (remainingMs <= 0) {
    value = label(`⏱ ${t('status.expired')}`, colors);
  } else {
    const warnMs = Math.max(60, Math.floor((TTL_SECONDS[cache.ttl ?? ''] ?? 300) / 5)) * 1000;
    const until = `⏱ ${formatAbsoluteTime(new Date(expiresAtMs), new Date(f.now), wallClock(display), 'format.untilTime')}`;
    value = remainingMs <= warnMs ? warning(until, colors) : `${getContextColor(0, colors)}${until}${RESET}`;
  }
  return `${label(t('label.promptCache'), colors)} ${value}`;
}

export function cacheHitRateLine(f: Frame): string | null {
  const ratio = f.stdin.prompt_cache?.hit_ratio;
  if (f.config?.display?.showCacheHitRate !== true || typeof ratio !== 'number' || !Number.isFinite(ratio)) return null;
  return `${label(t('label.cacheHitRate'), f.config?.colors)} ${Math.min(100, Math.max(0, ratio * 100)).toFixed(1)}%`;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** `Started: 2026-10-01 11:00 │ Last reply: 1m ago`. */
export function sessionTimeLine(f: Frame): string | null {
  const display = f.config?.display;
  const colors = f.config?.colors;
  const parts: string[] = [];
  const start = f.transcript.sessionStart;
  if (display?.showSessionStartDate === true && start) {
    const date = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())} ${pad(start.getHours())}:${pad(start.getMinutes())}`;
    parts.push(`${label(`${t('label.sessionStarted')}:`, colors)} ${date}`);
  }
  const lastReply = f.transcript.lastAssistantResponseAt;
  if (display?.showLastResponseAt === true && lastReply) {
    parts.push(`${label(`${t('label.lastReply')}:`, colors)} ${formatAgo(f.now - lastReply.getTime())}`);
  }
  return parts.length > 0 ? parts.join(` ${label('│', colors)} `) : null;
}

/** Approximate system RAM (expanded only). */
export function memoryLine(f: Frame, align: LabelAlign = {}): string | null {
  const memory = f.memoryUsage;
  if (f.config?.lineLayout !== 'expanded' || f.config?.display?.showMemoryUsage !== true || !memory) return null;
  const colors = f.config?.colors;
  const prefix = barLabel('label.approxRam', colors, { ...align, includeMemoryInWidth: true });
  const percent = `${getQuotaColor(memory.usedPercent, colors)}${memory.usedPercent}%${RESET}`;
  const bar = quotaBar(memory.usedPercent, f.barWidth, colors);
  return `${prefix} ${bar} ${formatBytes(memory.usedBytes)} / ${formatBytes(memory.totalBytes)} (${percent})`;
}

/** Added dirs on their own line, when addedDirsLayout is "line". */
export function addedDirsLine(f: Frame): string | null {
  const display = f.config?.display;
  if (display?.showAddedDirs === false || (display?.addedDirsLayout ?? 'inline') !== 'line') return null;
  const dirs = addedDirs(f, '', dim(', '));
  return dirs ? `${label('Added dirs:', f.config?.colors)} ${dirs}` : null;
}
