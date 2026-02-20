import type { RenderContext } from '../types.js';
import { dim } from './colors.js';

export function renderSummaryLines(ctx: RenderContext): string[] {
  if (!ctx.config.display.showSummary) return [];
  if (!ctx.summaryData?.summary) return [];

  const header = dim('─── session summary ───');
  const [line1, line2] = ctx.summaryData.summary;

  return [header, line1, line2];
}
