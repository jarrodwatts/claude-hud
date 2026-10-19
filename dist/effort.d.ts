import type { EffortFormatMode } from './config.js';
import type { StdinData } from './types.js';
export interface EffortInfo {
    level: string;
    symbol: string;
}
export declare function effortInfo(value: unknown): EffortInfo | null;
export declare function resolveEffortLevel(effort: StdinData['effort'], ultracodeActive?: boolean): EffortInfo | null;
/** `◑ high`, `◑`, or `high`, per display.effortFormat. */
export declare function formatEffort(info: EffortInfo, format: EffortFormatMode | undefined): string;
//# sourceMappingURL=effort.d.ts.map