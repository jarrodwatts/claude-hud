import type { RenderContext } from '../types.ts';
import { getContextUsage, stdinText, type ContextUsage } from '../stdin.ts';
import { resolveEffortLevel, type EffortInfo } from '../effort.ts';
import { getNativeCostUsd } from '../cost.ts';
import { formatSessionDuration } from '../utils/format.ts';

// Values computed from the render context alone, without I/O.

export const contextUsage = (ctx: RenderContext): ContextUsage =>
  getContextUsage(ctx.stdin, ctx.config?.display?.autoCompactWindow, ctx.transcript?.contextTokens);

export const sessionName = (ctx: RenderContext): string | undefined => stdinText(ctx.stdin.session_name);

export const claudeCodeVersion = (ctx: RenderContext): string | undefined => stdinText(ctx.stdin.version, 32);

export const outputStyle = (ctx: RenderContext): string | undefined => stdinText(ctx.stdin.output_style?.name, 40);

export const sessionDuration = (ctx: RenderContext): string => formatSessionDuration(ctx.stdin.cost?.total_duration_ms);

export const effort = (ctx: RenderContext): EffortInfo | null =>
  resolveEffortLevel(ctx.stdin.effort, ctx.transcript?.ultracodeActive);

export const sessionCostUsd = (ctx: RenderContext): number | null =>
  getNativeCostUsd(ctx.stdin, { allowRoutedCost: ctx.config?.display?.showRoutedCost === true });
