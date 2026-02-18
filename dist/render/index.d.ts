import type { RenderContext } from '../types.js';
export { visualLength } from './colors.js';
/**
 * Detect terminal width with multiple fallbacks.
 * The plugin runs as a piped subprocess of Claude Code, so process.stdout.columns
 * is typically undefined. We try several methods before falling back to 80.
 */
export declare function getTerminalWidth(): number;
/** Reset width cache (for testing) */
export declare function resetWidthCache(): void;
export declare function clearHighWater(): void;
export declare function render(ctx: RenderContext): void;
//# sourceMappingURL=index.d.ts.map