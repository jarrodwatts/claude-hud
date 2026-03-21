import type { AlertAction } from './types.js';
export type LineLayoutType = 'compact' | 'expanded';
export type AutocompactBufferMode = 'enabled' | 'disabled';
export type ContextValueMode = 'percent' | 'tokens' | 'remaining';
export type HudElement = 'project' | 'context' | 'usage' | 'environment' | 'framework' | 'tools' | 'agents' | 'todos' | 'alert';
export type HudColorName = 'red' | 'green' | 'yellow' | 'magenta' | 'cyan' | 'brightBlue' | 'brightMagenta';
/** A color value: named preset, 256-color index (0-255), or hex string (#rrggbb). */
export type HudColorValue = HudColorName | number | string;
export interface HudColorOverrides {
    context: HudColorValue;
    usage: HudColorValue;
    warning: HudColorValue;
    usageWarning: HudColorValue;
    critical: HudColorValue;
}
export declare const DEFAULT_ELEMENT_ORDER: HudElement[];
export interface HudConfig {
    lineLayout: LineLayoutType;
    showSeparators: boolean;
    pathLevels: 1 | 2 | 3;
    elementOrder: HudElement[];
    gitStatus: {
        enabled: boolean;
        showDirty: boolean;
        showAheadBehind: boolean;
        showFileStats: boolean;
    };
    display: {
        showModel: boolean;
        showProject: boolean;
        showContextBar: boolean;
        contextValue: ContextValueMode;
        showConfigCounts: boolean;
        showDuration: boolean;
        showSpeed: boolean;
        showTokenBreakdown: boolean;
        showUsage: boolean;
        usageBarEnabled: boolean;
        showTools: boolean;
        showAgents: boolean;
        showTodos: boolean;
        showSessionName: boolean;
        autocompactBuffer: AutocompactBufferMode;
        usageThreshold: number;
        sevenDayThreshold: number;
        environmentThreshold: number;
        customLine: string;
        showFrameworks: boolean;
        showBurnRate: boolean;
        showAlerts: boolean;
        activityIndicator: boolean;
        treePrefixes: boolean;
        mergeToolsAgents: boolean;
        barStyle: 'classic' | 'modern';
    };
    usage: {
        cacheTtlSeconds: number;
        failureCacheTtlSeconds: number;
    };
    colors: HudColorOverrides;
    frameworks: {
        agw: {
            enabled: boolean;
            endpoint: string;
        };
        agentTeams: {
            enabled: boolean;
        };
    };
    alerts: {
        context: {
            warningThreshold: number;
            criticalThreshold: number;
            actions: AlertAction;
        };
        usage5h: {
            warningThreshold: number;
            criticalThreshold: number;
            actions: AlertAction;
        };
        usage7d: {
            warningThreshold: number;
            actions: AlertAction;
        };
    };
}
export declare const DEFAULT_CONFIG: HudConfig;
export declare function getConfigPath(): string;
export declare function mergeConfig(userConfig: Partial<HudConfig>): HudConfig;
export declare function loadConfig(): Promise<HudConfig>;
//# sourceMappingURL=config.d.ts.map