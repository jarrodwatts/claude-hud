import type { RenderContext } from '../types.js';
/**
 * Renders the full session line (model + context bar + project + git + counts + usage + duration).
 * Used for compact layout mode. Width-aware: progressively drops sections to fit.
 *
 * @param maxWidth - Available terminal width. Sections are dropped right-to-left when overflowing.
 */
export declare function renderSessionLine(ctx: RenderContext, maxWidth?: number): string;
//# sourceMappingURL=session-line.d.ts.map