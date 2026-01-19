export type LineLayoutType = 'compact' | 'expanded';
export type AutocompactBufferMode = 'enabled' | 'disabled';
export interface HudConfig {
    lineLayout: LineLayoutType;
    showSeparators: boolean;
    pathLevels: 1 | 2 | 3;
    gitStatus: {
        enabled: boolean;
        showDirty: boolean;
        showAheadBehind: boolean;
        showFileStats: boolean;
    };
    display: {
        showModel: boolean;
        showContextBar: boolean;
        showConfigCounts: boolean;
        showDuration: boolean;
        showTokenBreakdown: boolean;
        showUsage: boolean;
        showTools: boolean;
        showAgents: boolean;
        showTodos: boolean;
        autocompactBuffer: AutocompactBufferMode;
        usageThreshold: number;
        environmentThreshold: number;
    };
}
export declare const DEFAULT_CONFIG: HudConfig;
export declare function getConfigPath(): string;
export declare function loadConfig(): Promise<HudConfig>;
//# sourceMappingURL=config.d.ts.map