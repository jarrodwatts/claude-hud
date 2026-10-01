import type { RenderContext } from '../types.js';
import type { EffortFormatMode } from '../config.js';
import { getProviderLabel } from '../stdin.js';
import { effort } from './derive.js';

function formatEffortSuffix(ctx: RenderContext, format: EffortFormatMode): string {
  const info = ctx.config?.display?.showEffortLevel ? effort(ctx) : null;
  if (!info) {
    return '';
  }
  // The symbol alone can't carry the ultracode marker, so symbol mode keeps the full form.
  if (format === 'symbol' && info.symbol && !info.level.startsWith('ultracode(')) {
    return ` ${info.symbol}`;
  }
  return format === 'text' || !info.symbol ? ` ${info.level}` : ` ${info.symbol} ${info.level}`;
}

export function formatModelDisplay(model: string, ctx: RenderContext): string {
  const display = ctx.config?.display;
  const effortSuffix = formatEffortSuffix(ctx, display?.effortFormat ?? 'full');

  const autoProvider = getProviderLabel(ctx.stdin);
  if (display?.showProvider) {
    const providerLabel = display.providerName?.trim() || autoProvider;
    const core = `${model}${effortSuffix}`;
    return providerLabel ? `${providerLabel} | ${core}` : core;
  }

  return autoProvider ? `${model}${effortSuffix} | ${autoProvider}` : `${model}${effortSuffix}`;
}
