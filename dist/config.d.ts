import type { Language } from './i18n/types.js';
export type LineLayoutType = 'compact' | 'expanded';
export type AutocompactBufferMode = 'enabled' | 'disabled';
export type ContextValueMode = 'percent' | 'tokens' | 'remaining' | 'both';
export type UsageValueMode = 'percent' | 'remaining';
export type GitBranchOverflowMode = 'truncate' | 'wrap';
/**
 * Controls how the model name is displayed in the HUD badge.
 *
 *   full:    Show the raw display name as-is (e.g. "Opus 4.6 (1M context)")
 *   compact: Strip redundant context-window suffix (e.g. "Opus 4.6")
 *   short:   Strip context suffix AND "Claude " prefix (e.g. "Opus 4.6")
 */
export type ModelFormatMode = 'full' | 'compact' | 'short';
export type TimeFormatMode = 'relative' | 'absolute' | 'both' | 'elapsed' | 'elapsedAndAbsolute';
export type CustomLinePosition = 'first' | 'last';
export type HourCycleMode = 'auto' | 'h11' | 'h12' | 'h23' | 'h24';
/**
 * Controls how many directory segments of cwd are shown in the project badge.
 *
 *   1 | 2 | 3: Show the last N segments (e.g. 2 -> "ai_workspace/knowledge-forge")
 *   'full':    Show the entire absolute path from root (e.g. "/Users/name/…")
 */
export type PathLevels = 1 | 2 | 3 | 'full';
export type HudElement = 'project' | 'addedDirs' | 'context' | 'usage' | 'promptCache' | 'memory' | 'environment' | 'tools' | 'skills' | 'mcp' | 'agents' | 'todos' | 'sessionTime' | 'providerQuota';
/**
 * Coarse, orderable segments of the first HUD line (the identity/project
 * line). Shared by the expanded project line and the compact session line:
 *
 *   model:       provider + model badge + effort (compact mode also keeps the
 *                context bar attached to this segment)
 *   project:     project path + added dirs + git status (kept as one segment)
 *   advisor:     advisor model label
 *   sessionName: session title from /rename
 *   version:     Claude Code version
 *   extra:       extra-cmd custom label
 *   duration:    session duration
 *   cost:        session cost estimate
 *   speed:       output speed
 *   auth:        auth method / account
 */
export type FirstLineSegment = 'model' | 'project' | 'advisor' | 'sessionName' | 'version' | 'extra' | 'duration' | 'cost' | 'speed' | 'auth';
export type AddedDirsLayout = 'inline' | 'line';
export type HudColorName = 'dim' | 'red' | 'green' | 'yellow' | 'magenta' | 'cyan' | 'brightBlue' | 'brightMagenta';
/** A color value: named preset, 256-color index (0-255), or hex string (#rrggbb). */
export type HudColorValue = HudColorName | number | string;
export interface HudColorOverrides {
    context: HudColorValue;
    usage: HudColorValue;
    warning: HudColorValue;
    usageWarning: HudColorValue;
    critical: HudColorValue;
    model: HudColorValue;
    project: HudColorValue;
    git: HudColorValue;
    gitBranch: HudColorValue;
    label: HudColorValue;
    custom: HudColorValue;
    barFilled: string;
    barEmpty: string;
}
export declare const DEFAULT_ELEMENT_ORDER: HudElement[];
export declare const DEFAULT_MERGE_GROUPS: HudElement[][];
export declare const DEFAULT_PROJECT_LINE_ORDER: FirstLineSegment[];
export interface HudConfig {
    language: Language;
    lineLayout: LineLayoutType;
    showSeparators: boolean;
    pathLevels: PathLevels;
    maxWidth: number | null;
    forceMaxWidth: boolean;
    elementOrder: HudElement[];
    projectLineOrder: FirstLineSegment[];
    gitStatus: {
        enabled: boolean;
        showDirty: boolean;
        showAheadBehind: boolean;
        showFileStats: boolean;
        branchOverflow: GitBranchOverflowMode;
        pushWarningThreshold: number;
        pushCriticalThreshold: number;
    };
    jjStatus: {
        enabled: boolean;
        showDirty: boolean;
        showConflicts: boolean;
    };
    display: {
        showModel: boolean;
        showProject: boolean;
        showAddedDirs: boolean;
        addedDirsLayout: AddedDirsLayout;
        showContextBar: boolean;
        contextValue: ContextValueMode;
        showConfigCounts: boolean;
        showCost: boolean;
        showRoutedCost: boolean;
        showDuration: boolean;
        showSpeed: boolean;
        showTokenBreakdown: boolean;
        showUsage: boolean;
        usageValue: UsageValueMode;
        usageBarEnabled: boolean;
        showResetLabel: boolean;
        usageCompact: boolean;
        showTools: boolean;
        showSkills: boolean;
        showMcp: boolean;
        toolNameMaxLength: number;
        toolsMaxVisible: number;
        showAgents: boolean;
        showTodos: boolean;
        showSessionName: boolean;
        showAuth: boolean;
        showAuthUser: boolean;
        authUserLength: number;
        showClaudeCodeVersion: boolean;
        showEffortLevel: boolean;
        showMemoryUsage: boolean;
        showPromptCache: boolean;
        promptCacheTtlSeconds: number;
        showSessionTokens: boolean;
        showOutputStyle: boolean;
        showSessionStartDate: boolean;
        showLastResponseAt: boolean;
        showCompactions: boolean;
        mergeGroups: HudElement[][];
        rightAlign: HudElement[];
        autocompactBuffer: AutocompactBufferMode;
        contextWarningThreshold: number;
        contextCriticalThreshold: number;
        usageThreshold: number;
        sevenDayThreshold: number;
        environmentThreshold: number;
        externalUsagePath: string;
        externalUsageWritePath: string;
        externalUsageFreshnessMs: number;
        modelFormat: ModelFormatMode;
        modelOverride: string;
        modelSource: 'auto' | 'stdin' | 'transcript';
        showProvider: boolean;
        providerName: string;
        customLine: string;
        customLinePosition: CustomLinePosition;
        timeFormat: TimeFormatMode;
        hourCycle: HourCycleMode;
        showClockSeconds: boolean;
        showAdvisor: boolean;
        advisorOverride: string;
        autoCompactWindow: number | null;
        showProviderQuota: boolean;
    };
    providerQuota: {
        minimax: {
            apiKey: string;
        };
        zhipu: {
            apiKey: string;
        };
    };
    colors: HudColorOverrides;
}
export declare const DEFAULT_CONFIG: HudConfig;
export declare function getConfigPath(): string;
export declare function mergeConfig(userConfig: Partial<HudConfig>): HudConfig;
export declare function loadConfig(): Promise<HudConfig>;
//# sourceMappingURL=config.d.ts.map