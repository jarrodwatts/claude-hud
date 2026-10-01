import type { Frame } from './frame.js';
import { coloredBar, getContextColor, label, RESET } from './colors.js';
import { t } from '../i18n/index.js';
import { formatContextValue, formatTokens } from '../utils/format.js';
import { contextUsage } from './derive.js';
import { barLabel, type LabelAlign } from './labels.js';

function thresholds(f: Frame) {
  return {
    warning: f.config?.display?.contextWarningThreshold,
    critical: f.config?.display?.contextCriticalThreshold,
  };
}

/** The context bar (when shown) and value, e.g. `█████░░░░░ 45%`. */
export function contextBarAndValue(f: Frame): { bar: string | null; value: string } {
  const display = f.config?.display;
  const colors = f.config?.colors;
  const context = contextUsage(f);
  const value = `${getContextColor(context.percent, colors, thresholds(f))}${formatContextValue(context, display?.contextValue ?? 'percent')}${RESET}`;
  const bar = display?.showContextBar !== false
    ? coloredBar(context.percent, f.barWidth, colors, thresholds(f))
    : null;
  return { bar, value };
}

/** ` (in: 12k, cache: 180k)` once context reaches the critical threshold. */
export function tokenBreakdown(f: Frame): string {
  const display = f.config?.display;
  const usage = f.stdin.context_window?.current_usage;
  if (display?.showTokenBreakdown === false || !usage) return '';
  if (contextUsage(f).percent < (display?.contextCriticalThreshold ?? 85)) return '';
  const input = formatTokens(usage.input_tokens ?? 0);
  const cache = formatTokens((usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0));
  return label(` (${t('format.in')}: ${input}, ${t('format.cache')}: ${cache})`, f.config?.colors);
}

export function contextLine(f: Frame, align: LabelAlign = {}): string {
  const { bar, value } = contextBarAndValue(f);
  const prefix = barLabel('label.context', f.config?.colors, align);
  return `${prefix} ${bar ? `${bar} ` : ''}${value}${tokenBreakdown(f)}`;
}
