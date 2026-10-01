import type { RenderContext } from '../types.js';

// Everything a render reads, with the clock and terminal width sampled once.
export interface Frame extends RenderContext {
  now: number;
  /** Lines wrap to this width; null when the terminal width is unknown. */
  width: number | null;
  barWidth: number;
}

export type Layout = 'expanded' | 'compact';

export function createFrame(ctx: RenderContext, columns: number | null, now: number): Frame {
  const maxWidth = ctx.config?.maxWidth ?? null;
  const width = ctx.config?.forceMaxWidth && maxWidth !== null ? maxWidth : columns ?? maxWidth;
  const barWidth = columns === null || columns >= 100 ? 10 : columns >= 60 ? 6 : 4;
  return { ...ctx, now, width, barWidth };
}
