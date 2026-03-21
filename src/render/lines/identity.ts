import type { RenderContext } from '../../types.js';
import { getContextPercent, getBufferedPercent, getTotalTokens } from '../../stdin.js';
import { coloredBar, dim, getContextColor, RESET } from '../colors.js';
import { getAdaptiveBarWidth } from '../../utils/terminal.js';
import { formatCost } from '../../cost-tracker.js';

const DEBUG = process.env.DEBUG?.includes('claude-hud') || process.env.DEBUG === '*';

const SPARK_CHARS = '▁▂▃▄▅▆▇█';

function renderSparkline(values: number[]): string {
  if (values.length < 2) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values.map(v => {
    const idx = Math.round(((v - min) / range) * (SPARK_CHARS.length - 1));
    return SPARK_CHARS[idx];
  }).join('');
}

function ordinal(n: number): string {
  if (n === 1) return '1st';
  if (n === 2) return '2nd';
  if (n === 3) return '3rd';
  return `${n}th`;
}

export function renderIdentityLine(ctx: RenderContext): string {
  const rawPercent = getContextPercent(ctx.stdin);
  const bufferedPercent = getBufferedPercent(ctx.stdin);
  const autocompactMode = ctx.config?.display?.autocompactBuffer ?? 'enabled';
  const percent = autocompactMode === 'disabled' ? rawPercent : bufferedPercent;
  const colors = ctx.config?.colors;

  if (DEBUG && autocompactMode === 'disabled') {
    console.error(`[claude-hud:context] autocompactBuffer=disabled, showing raw ${rawPercent}% (buffered would be ${bufferedPercent}%)`);
  }

  const display = ctx.config?.display;
  const contextValueMode = display?.contextValue ?? 'percent';
  const contextValue = formatContextValue(ctx, percent, contextValueMode);

  const alertThresholds = ctx.config.alerts?.context
    ? { warningThreshold: ctx.config.alerts.context.warningThreshold, criticalThreshold: ctx.config.alerts.context.criticalThreshold }
    : undefined;

  const contextValueDisplay = `${getContextColor(percent, colors, alertThresholds)}${contextValue}${RESET}`;

  const barStyle = display?.barStyle ?? 'classic';
  let line = display?.showContextBar !== false
    ? `${dim('Context')} ${coloredBar(percent, getAdaptiveBarWidth(), colors, barStyle, alertThresholds)} ${contextValueDisplay}`
    : `${dim('Context')} ${contextValueDisplay}`;

  // Progressive content reduction based on terminal width
  const tw = ctx.terminalWidth;
  const isNarrow = tw !== null && tw < 80;
  const isVeryNarrow = tw !== null && tw < 60;

  if (!isVeryNarrow && display?.showTokenBreakdown !== false && percent >= 85) {
    const usage = ctx.stdin.context_window?.current_usage;
    if (usage) {
      const input = formatTokens(usage.input_tokens ?? 0);
      const cache = formatTokens((usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0));
      line += dim(` (in: ${input}, cache: ${cache})`);
    }
  }

  if (ctx.costEstimate && ctx.config.display.showCost) {
    if (!isNarrow) {
      line += ` ${dim('│')} ${dim(formatCost(ctx.costEstimate.sessionCost))}`;
    }
  }

  if (!isNarrow && ctx.burnRate && ctx.config.display.showBurnRate) {
    const formatted = ctx.burnRate.tokensPerMinute >= 1000
      ? `${(ctx.burnRate.tokensPerMinute / 1000).toFixed(1)}k`
      : `${ctx.burnRate.tokensPerMinute}`;
    line += ` ${dim('│')} ${dim(`${formatted} tok/m`)}`;
  }

  if (!isNarrow && ctx.burnRate && ctx.burnRate.tokensPerMinute > 0 && percent >= (alertThresholds?.warningThreshold ?? 70)) {
    const remaining = ctx.stdin.context_window?.context_window_size
      ? ctx.stdin.context_window.context_window_size - (ctx.stdin.context_window?.current_usage?.input_tokens ?? 0)
      : 0;
    if (remaining > 0) {
      const minsLeft = Math.round(remaining / ctx.burnRate.tokensPerMinute);
      const timeStr = minsLeft >= 60 ? `${Math.floor(minsLeft / 60)}h ${minsLeft % 60}m` : `${minsLeft}m`;
      line += dim(` ~${timeStr}`);
    }
  }

  if (!isVeryNarrow && ctx.sessionStats.autocompactCount > 0) {
    line += dim(` (${ordinal(ctx.sessionStats.autocompactCount)} compact)`);
  }

  if (!isNarrow && ctx.sparkline && ctx.sparkline.length >= 3) {
    line += ` ${dim(renderSparkline(ctx.sparkline))}`;
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

function formatContextValue(ctx: RenderContext, percent: number, mode: 'percent' | 'tokens' | 'remaining'): string {
  if (mode === 'tokens') {
    const totalTokens = getTotalTokens(ctx.stdin);
    const size = ctx.stdin.context_window?.context_window_size ?? 0;
    if (size > 0) {
      return `${formatTokens(totalTokens)}/${formatTokens(size)}`;
    }
    return formatTokens(totalTokens);
  }

  if (mode === 'remaining') {
    return `${Math.max(0, 100 - percent)}%`;
  }

  return `${percent}%`;
}
