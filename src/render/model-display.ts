import type { RenderContext } from '../types.js';
import { getProviderLabel } from '../stdin.js';

export function formatModelDisplay(model: string, ctx: RenderContext): string {
  let effortSuffix = '';
  if (ctx.effortLevel && ctx.effortSymbol) {
    effortSuffix = ` ${ctx.effortSymbol} ${ctx.effortLevel}`;
  } else if (ctx.effortLevel) {
    effortSuffix = ` ${ctx.effortLevel}`;
  }

  const display = ctx.config?.display;
  const autoProvider = getProviderLabel(ctx.stdin);
  if (display?.showProvider) {
    const providerLabel = display.providerName?.trim() || autoProvider;
    const core = `${model}${effortSuffix}`;
    return providerLabel ? `${providerLabel} | ${core}` : core;
  }

  return autoProvider ? `${model}${effortSuffix} | ${autoProvider}` : `${model}${effortSuffix}`;
}
