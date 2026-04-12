import type { TimeFormatMode } from '../config.js';
/**
 * Formats a usage-window reset timestamp for display in the HUD.
 *
 * @param resetAt - The reset timestamp, or null if unknown.
 * @param mode    - How to express the time:
 *   - `'relative'` (default) — duration until reset, e.g. `2h 30m`
 *   - `'absolute'`           — wall-clock time,       e.g. `at 14:30` (locale-aware)
 *   - `'both'`               — both combined,          e.g. `2h 30m, at 14:30` (locale-aware)
 * @returns A formatted string, or an empty string when the reset is in the past
 *          or the date is unknown.
 */
export declare function formatResetTime(resetAt: Date | null, mode?: TimeFormatMode): string;
//# sourceMappingURL=format-reset-time.d.ts.map