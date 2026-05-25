import type { RenderContext } from '../../types.js';
import { green, yellow, red, dim, RESET, label } from '../colors.js';
import { getAdaptiveBarWidth } from '../../utils/terminal.js';
import { t } from '../../i18n/index.js';

function formatTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}

function getColorFn(percent: number) {
  return percent >= 70 ? green : percent >= 40 ? yellow : red;
}

export function renderCacheHitRateLine(ctx: RenderContext): string | null {
  const display = ctx.config?.display;
  if (!display?.showCacheHitRate) {
    return null;
  }

  const usage = ctx.stdin.context_window?.current_usage;
  if (!usage) {
    return null;
  }

  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheCreation = usage.cache_creation_input_tokens ?? 0;
  const inputTokens = usage.input_tokens ?? 0;
  const totalInput = inputTokens + cacheCreation + cacheRead;

  if (totalInput === 0) {
    return null;
  }

  // 当前调用命中率（一位小数）
  const hitRate = (cacheRead / totalInput) * 100;
  const percent = Math.min(100, Math.max(0, hitRate));
  const percentStr = percent.toFixed(1);
  const percentDisplay = parseFloat(percentStr);
  const colors = ctx.config?.colors;
  const colorFn = getColorFn(percentDisplay);
  const valueDisplay = `${colorFn(`${percentStr}%`)}${RESET}`;

  // 进度条
  let bar = '';
  if (display.showContextBar !== false) {
    const width = getAdaptiveBarWidth();
    const filled = Math.round((percentDisplay / 100) * width);
    const empty = width - filled;
    bar = `${colorFn('█'.repeat(filled))}${RESET}${dim('░'.repeat(empty))}`;
  }

  const labelStr = label(t('label.cacheHitRate'), colors);
  const mainLine = bar
    ? `${labelStr} ${bar} ${valueDisplay}`
    : `${labelStr} ${valueDisplay}`;

  // 最近一次调用的 token 数据
  const callDetail = dim(`(${t('format.currentIn')}:${formatTokens(inputTokens)} ${t('format.currentOut')}:${formatTokens(usage.output_tokens ?? 0)} ${t('format.currentCache')}:${formatTokens(cacheRead)} ${t('format.currentCacheHitRate')}:${percentStr}%)`);

  return `${mainLine} ${callDetail}`;
}
