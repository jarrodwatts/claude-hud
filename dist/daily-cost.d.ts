import type { StdinData } from './types.js';
/**
 * Minimum interval between ledger rewrites when the accounted content did not
 * change, mirroring the external-usage snapshot semantics: content changes
 * (a higher total, a new session, day rollover) always write, while renders
 * that only refresh last-seen timestamps are throttled. Status line refreshes
 * are event-driven and can fire in rapid bursts (debounced at 300ms).
 */
export declare const DAILY_COST_WRITE_THROTTLE_MS = 30000;
export type CostTotals = {
    todayUsd: number;
    weekUsd: number | null;
};
export type DailyCostDeps = {
    homeDir: () => string;
    now: () => number;
};
export declare function getDailyCostLedgerPath(homeDir: string): string;
/**
 * Accumulate the native stdin cost into a per-day ledger and return today's
 * cumulative spend across sessions plus the spend since the weekly quota
 * window opened, or null when nothing has been recorded.
 *
 * On each render the current session's entry is advanced to the highest
 * native total seen; the first sighting of a session today records the
 * baseline so only today's increment counts. At local midnight, still-active
 * sessions carry over with their baseline reset to the last known total.
 */
export declare function getCostTotals(stdin: StdinData, options?: {
    allowRoutedCost?: boolean;
    sevenDayResetAt?: Date | null;
}, deps?: DailyCostDeps): CostTotals | null;
/** Today's cumulative spend across sessions, or null when nothing is recorded. */
export declare function getDailyCostUsd(stdin: StdinData, options?: {
    allowRoutedCost?: boolean;
}, deps?: DailyCostDeps): number | null;
//# sourceMappingURL=daily-cost.d.ts.map