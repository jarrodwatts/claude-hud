import type { RenderContext } from '../types.js';
import type { EffortFormatMode } from '../config.js';
import { getProviderLabel } from '../stdin.js';

function formatEffortSuffix(ctx: RenderContext, format: EffortFormatMode): string {
  if (!ctx.effortLevel) {
    return '';
  }
  // Ultracode's marker lives in the level text ("ultracode(xhigh)"), so the
  // symbol alone cannot represent it; keep the full form in symbol mode.
  const isUltracode = ctx.effortLevel.startsWith('ultracode(');
  if (format === 'symbol' && ctx.effortSymbol && !isUltracode) {
    return ` ${ctx.effortSymbol}`;
  }
  if (format === 'text' || !ctx.effortSymbol) {
    return ` ${ctx.effortLevel}`;
  }
  return ` ${ctx.effortSymbol} ${ctx.effortLevel}`;
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
