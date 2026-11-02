import type { RenderContext } from '../types.ts';
import { RESET } from './colors.ts';
import { wrapToWidth } from './ansi.ts';
import { compactLines } from './compact.ts';
import { expandedLines } from './expanded.ts';
import { createFrame } from './frame.ts';

/** The lines the HUD prints, wrapped to the terminal width when it is known. */
export function renderLines(ctx: RenderContext, columns: number | null, now: number): string[] {
  const frame = createFrame(ctx, columns, now);
  const lines = (ctx.config?.lineLayout ?? 'expanded') === 'expanded' ? expandedLines(frame) : compactLines(frame);
  return lines
    .flatMap((line) => line.split('\n'))
    .flatMap((line) => wrapToWidth(line, frame.width ?? 0))
    .map((line) => `${RESET}${line}`);
}
