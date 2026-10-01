import type { StdinData } from './types.js';
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
export declare function getCostTotals(stdin: StdinData, options?: {
    allowRoutedCost?: boolean;
    sevenDayResetAt?: Date | null;
}, deps?: DailyCostDeps): CostTotals | null;
//# sourceMappingURL=daily-cost.d.ts.map