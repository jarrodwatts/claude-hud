import type { RenderContext } from '../../types.js';
import { dim, green, yellow, red, label, RESET } from '../colors.js';

const CACHE_TTL_MINUTES = 60;
const AGE_WARN_MINUTES = 45;

interface CacheStats {
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalInputTokens: number;
  hitRatePercent: number;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(0)}k`;
  }
  return n.toString();
}

function computeCacheStats(ctx: RenderContext): CacheStats | null {
  const usage = ctx.stdin.context_window?.current_usage;
  if (!usage) {
    return null;
  }

  const inputTokens = usage.input_tokens ?? 0;
  const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
  const cacheCreationTokens = usage.cache_creation_input_tokens ?? 0;
  const totalInputTokens = inputTokens + cacheReadTokens + cacheCreationTokens;

  if (totalInputTokens === 0) {
    return null;
  }

  const hitRatePercent = Math.round((cacheReadTokens / totalInputTokens) * 100);

  return {
    inputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    totalInputTokens,
    hitRatePercent,
  };
}

function colorizeHitRate(percent: number): string {
  const text = `${percent}%`;
  if (percent >= 70) return green(text);
  if (percent >= 40) return yellow(text);
  return red(text);
}

interface AgeRender {
  text: string;
  expired: boolean;
}

function renderAge(lastTurnAt: Date | undefined, now: number): AgeRender | null {
  if (!lastTurnAt) {
    return null;
  }

  const diffMs = now - lastTurnAt.getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) {
    return null;
  }

  const ageMinutes = Math.floor(diffMs / 60_000);
  const expired = ageMinutes >= CACHE_TTL_MINUTES;
  const ageLabel = formatAge(ageMinutes);

  if (expired) {
    return {
      text: `${red(`age ${ageLabel}`)} ${red('⚠ expired')}`,
      expired: true,
    };
  }

  if (ageMinutes >= AGE_WARN_MINUTES) {
    return {
      text: yellow(`age ${ageLabel} ◐`),
      expired: false,
    };
  }

  return {
    text: green(`age ${ageLabel} ✓`),
    expired: false,
  };
}

function formatAge(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (remainder === 0) {
    return `${hours}h`;
  }
  return `${hours}h${remainder}m`;
}

export function renderCacheLine(ctx: RenderContext): string | null {
  const display = ctx.config?.display;
  if (display?.showCacheLine === false) {
    return null;
  }

  const stats = computeCacheStats(ctx);
  if (!stats) {
    return null;
  }

  const colors = ctx.config?.colors;
  const headLabel = label('Cache', colors);
  const hit = `hit ${colorizeHitRate(stats.hitRatePercent)}`;
  const totals = dim(
    `input ${formatTokens(stats.inputTokens)} + cache_read ${formatTokens(stats.cacheReadTokens)} + cache_write ${formatTokens(stats.cacheCreationTokens)} (total ${formatTokens(stats.totalInputTokens)})`
  );

  const parts: string[] = [`${headLabel} ${hit}`, totals];

  const age = renderAge(ctx.transcript.lastAssistantTurnAt, Date.now());
  if (age) {
    parts.push(age.text);
  }

  return `${parts.join(` ${dim('│')} `)}${RESET}`;
}

// Exposed for tests.
export const __internals = {
  computeCacheStats,
  colorizeHitRate,
  renderAge,
  formatAge,
  formatTokens,
  CACHE_TTL_MINUTES,
  AGE_WARN_MINUTES,
};
