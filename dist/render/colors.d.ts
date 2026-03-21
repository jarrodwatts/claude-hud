import type { HudColorOverrides } from '../config.js';
export declare const RESET = "\u001B[0m";
export declare const BAR_CHARS: {
    readonly classic: {
        readonly filled: "█";
        readonly empty: "░";
    };
    readonly modern: {
        readonly filled: "▰";
        readonly empty: "▱";
    };
};
export declare function colorize(text: string, color: string): string;
export declare function green(text: string): string;
export declare function yellow(text: string): string;
export declare function red(text: string): string;
export declare function cyan(text: string): string;
export declare function magenta(text: string): string;
export declare function dim(text: string): string;
export declare function claudeOrange(text: string): string;
export declare function warning(text: string, colors?: Partial<HudColorOverrides>): string;
export declare function critical(text: string, colors?: Partial<HudColorOverrides>): string;
export declare function getContextColor(percent: number, colors?: Partial<HudColorOverrides>, thresholds?: {
    warningThreshold: number;
    criticalThreshold: number;
}): string;
export declare function getQuotaColor(percent: number, colors?: Partial<HudColorOverrides>, thresholds?: {
    warningThreshold: number;
    criticalThreshold: number;
}): string;
export declare function quotaBar(percent: number, width?: number, colors?: Partial<HudColorOverrides>, barStyle?: 'classic' | 'modern', thresholds?: {
    warningThreshold: number;
    criticalThreshold: number;
}): string;
export declare function coloredBar(percent: number, width?: number, colors?: Partial<HudColorOverrides>, barStyle?: 'classic' | 'modern', thresholds?: {
    warningThreshold: number;
    criticalThreshold: number;
}): string;
//# sourceMappingURL=colors.d.ts.map