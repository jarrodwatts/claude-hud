import type { StdinData } from './types.js';
export declare function readStdin(): Promise<StdinData | null>;
export declare function getTotalTokens(stdin: StdinData): number;
export declare function getContextPercent(stdin: StdinData): number;
export declare function getBufferedPercent(stdin: StdinData): number;
export declare function getModelName(stdin: StdinData): string;
//# sourceMappingURL=stdin.d.ts.map