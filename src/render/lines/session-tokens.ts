import type { RenderContext } from '../../types.js';
import { green, yellow, red, label, dim, RESET } from '../colors.js';
import { t } from '../../i18n/index.js';

function formatTokens(n: number): string {
  if (n >= 1000000) {
    return `${(n / 1000000).toFixed(1)}M`;
  }
  if (n >= 1000) {
    return `${(n / 1000).toFixed(0)}k`;
  }
  return n.toString();
}

function getColorFn(percent: number) {
  return percent >= 70 ? green : percent >= 40 ? yellow : red;
}

export function renderSessionTokensLine(ctx: RenderContext): string | null {
  const display = ctx.config?.display;
  if (display?.showSessionTokens === false) {
    return null;
  }

  const tokens = ctx.transcript.sessionTokens;
  if (!tokens) {
    return null;
  }

  const total = tokens.inputTokens + tokens.outputTokens + tokens.cacheCreationTokens + tokens.cacheReadTokens;
  if (total === 0) {
    return null;
  }

  const colors = ctx.config?.colors;
  const parts: string[] = [
    `${t('format.totalIn')}: ${formatTokens(tokens.inputTokens)}`,
    `${t('format.totalOut')}: ${formatTokens(tokens.outputTokens)}`,
  ];

  if (tokens.cacheCreationTokens > 0 || tokens.cacheReadTokens > 0) {
    parts.push(`${t('format.totalCache')}: ${formatTokens(tokens.cacheCreationTokens + tokens.cacheReadTokens)}`);
  }

  // 会话平均命中率
  const cacheTotal = tokens.inputTokens + tokens.cacheCreationTokens + tokens.cacheReadTokens;
  let avgStr = '';
  if (cacheTotal > 0) {
    const hitRate = (tokens.cacheReadTokens / cacheTotal) * 100;
    const percent = Math.min(100, Math.max(0, hitRate));
    const percentStr = percent.toFixed(1);
    const colorFn = getColorFn(parseFloat(percentStr));
    avgStr = ` ${dim('│')} ${t('label.avg')} ${colorFn(`${percentStr}%`)}${RESET}`;
  }

  return label(`Tokens ${formatTokens(total)} (${parts.join(', ')})`, colors) + avgStr;
}
