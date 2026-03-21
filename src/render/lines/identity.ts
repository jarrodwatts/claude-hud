import type { RenderContext } from '../../types.js';
import { getContextPercent, getBufferedPercent } from '../../stdin.js';
import { coloredBar, dim, getContextColor, RESET, red, warning } from '../colors.js';
import { getLabels } from '../../i18n.js';
import { getAdaptiveBarWidth, isNarrowTerminal, isVeryNarrowTerminal } from '../../utils/terminal.js';
import { formatCost, predictSessionCost } from '../../cost-tracker.js';
import { formatTokens, formatContextValue } from '../../utils/format.js';

const DEBUG = process.env.DEBUG?.includes('claude-hud') || process.env.DEBUG === '*';

const HEATMAP_CHARS = '▁▂▃▄▅▆▇█';

function renderHeatmap(values: number[]): string {
  if (values.length < 2) return '';

  // Color gradient: green (low) → yellow (mid) → red (high)
  return values.map(v => {
    const idx = Math.min(Math.round((v / 100) * (HEATMAP_CHARS.length - 1)), HEATMAP_CHARS.length - 1);
    const char = HEATMAP_CHARS[idx];

    // ANSI 256-color: green(34) → yellow(226) → red(196)
    let colorCode: number;
    if (v < 50) {
      // Green to yellow gradient (ANSI 256: 34 → 226)
      colorCode = v < 25 ? 34 : v < 40 ? 70 : 226;
    } else if (v < 80) {
      // Yellow to orange (226 → 208)
      colorCode = v < 65 ? 226 : 208;
    } else {
      // Orange to red (208 → 196)
      colorCode = v < 90 ? 208 : 196;
    }

    return `\x1b[38;5;${colorCode}m${char}\x1b[0m`;
  }).join('');
}

function ordinal(n: number): string {
  if (n === 1) return '1st';
  if (n === 2) return '2nd';
  if (n === 3) return '3rd';
  return `${n}th`;
}

export function renderIdentityLine(ctx: RenderContext): string {
  const labels = getLabels(ctx.locale || 'en');
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
    ? `${dim(labels.context)} ${coloredBar(percent, getAdaptiveBarWidth(), colors, barStyle, alertThresholds)} ${contextValueDisplay}`
    : `${dim(labels.context)} ${contextValueDisplay}`;

  // Progressive content reduction based on terminal width
  const tw = ctx.terminalWidth;
  const isNarrow = isNarrowTerminal(tw);
  const isVeryNarrow = isVeryNarrowTerminal(tw);

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
      const contextSize = ctx.stdin.context_window?.context_window_size ?? 0;
      const inputTokens = ctx.stdin.context_window?.current_usage?.input_tokens ?? 0;
      const prediction = predictSessionCost(ctx.costEstimate.sessionCost, ctx.burnRate ?? null, contextSize, inputTokens);
      if (prediction) {
        line += dim(` →${prediction}`);
      }
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
    line += ` ${renderHeatmap(ctx.sparkline)}`;
  }

  if (!isNarrow && ctx.apiLatency !== null && ctx.apiLatency !== undefined && ctx.apiLatency > 0) {
    const latencyColor = ctx.apiLatency > 5000 ? red : ctx.apiLatency > 2000 ? warning : dim;
    line += ` ${latencyColor(`${ctx.apiLatency}ms`)}`;
  }

  return line;
}

