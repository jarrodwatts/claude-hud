import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
export const DEFAULT_CONFIG = {
    lineLayout: 'expanded',
    showSeparators: false,
    pathLevels: 1,
    gitStatus: {
        enabled: true,
        showDirty: true,
        showAheadBehind: false,
        showFileStats: false,
    },
    display: {
        showModel: true,
        showContextBar: true,
        showConfigCounts: true,
        showDuration: true,
        showTokenBreakdown: true,
        showUsage: true,
        showTools: true,
        showAgents: true,
        showTodos: true,
        autocompactBuffer: 'enabled',
        usageThreshold: 0,
        environmentThreshold: 0,
    },
};
export function getConfigPath() {
    const homeDir = os.homedir();
    return path.join(homeDir, '.claude', 'plugins', 'claude-hud', 'config.json');
}
function validatePathLevels(value) {
    return value === 1 || value === 2 || value === 3;
}
function validateLineLayout(value) {
    return value === 'compact' || value === 'expanded';
}
function validateAutocompactBuffer(value) {
    return value === 'enabled' || value === 'disabled';
}
function migrateConfig(userConfig) {
    const migrated = { ...userConfig };
    if ('layout' in userConfig && !('lineLayout' in userConfig)) {
        if (userConfig.layout === 'separators') {
            migrated.lineLayout = 'compact';
            migrated.showSeparators = true;
        }
        else {
            migrated.lineLayout = 'compact';
            migrated.showSeparators = false;
        }
        delete migrated.layout;
    }
    return migrated;
}
function validateThreshold(value, max = 100) {
    if (typeof value !== 'number')
        return 0;
    return Math.max(0, Math.min(max, value));
}
function mergeConfig(userConfig) {
    const migrated = migrateConfig(userConfig);
    const lineLayout = validateLineLayout(migrated.lineLayout)
        ? migrated.lineLayout
        : DEFAULT_CONFIG.lineLayout;
    const showSeparators = typeof migrated.showSeparators === 'boolean'
        ? migrated.showSeparators
        : DEFAULT_CONFIG.showSeparators;
    const pathLevels = validatePathLevels(migrated.pathLevels)
        ? migrated.pathLevels
        : DEFAULT_CONFIG.pathLevels;
    const gitStatus = {
        enabled: typeof migrated.gitStatus?.enabled === 'boolean'
            ? migrated.gitStatus.enabled
            : DEFAULT_CONFIG.gitStatus.enabled,
        showDirty: typeof migrated.gitStatus?.showDirty === 'boolean'
            ? migrated.gitStatus.showDirty
            : DEFAULT_CONFIG.gitStatus.showDirty,
        showAheadBehind: typeof migrated.gitStatus?.showAheadBehind === 'boolean'
            ? migrated.gitStatus.showAheadBehind
            : DEFAULT_CONFIG.gitStatus.showAheadBehind,
        showFileStats: typeof migrated.gitStatus?.showFileStats === 'boolean'
            ? migrated.gitStatus.showFileStats
            : DEFAULT_CONFIG.gitStatus.showFileStats,
    };
    const display = {
        showModel: typeof migrated.display?.showModel === 'boolean'
            ? migrated.display.showModel
            : DEFAULT_CONFIG.display.showModel,
        showContextBar: typeof migrated.display?.showContextBar === 'boolean'
            ? migrated.display.showContextBar
            : DEFAULT_CONFIG.display.showContextBar,
        showConfigCounts: typeof migrated.display?.showConfigCounts === 'boolean'
            ? migrated.display.showConfigCounts
            : DEFAULT_CONFIG.display.showConfigCounts,
        showDuration: typeof migrated.display?.showDuration === 'boolean'
            ? migrated.display.showDuration
            : DEFAULT_CONFIG.display.showDuration,
        showTokenBreakdown: typeof migrated.display?.showTokenBreakdown === 'boolean'
            ? migrated.display.showTokenBreakdown
            : DEFAULT_CONFIG.display.showTokenBreakdown,
        showUsage: typeof migrated.display?.showUsage === 'boolean'
            ? migrated.display.showUsage
            : DEFAULT_CONFIG.display.showUsage,
        showTools: typeof migrated.display?.showTools === 'boolean'
            ? migrated.display.showTools
            : DEFAULT_CONFIG.display.showTools,
        showAgents: typeof migrated.display?.showAgents === 'boolean'
            ? migrated.display.showAgents
            : DEFAULT_CONFIG.display.showAgents,
        showTodos: typeof migrated.display?.showTodos === 'boolean'
            ? migrated.display.showTodos
            : DEFAULT_CONFIG.display.showTodos,
        autocompactBuffer: validateAutocompactBuffer(migrated.display?.autocompactBuffer)
            ? migrated.display.autocompactBuffer
            : DEFAULT_CONFIG.display.autocompactBuffer,
        usageThreshold: validateThreshold(migrated.display?.usageThreshold, 100),
        environmentThreshold: validateThreshold(migrated.display?.environmentThreshold, 100),
    };
    return { lineLayout, showSeparators, pathLevels, gitStatus, display };
}
export async function loadConfig() {
    const configPath = getConfigPath();
    try {
        if (!fs.existsSync(configPath)) {
            return DEFAULT_CONFIG;
        }
        const content = fs.readFileSync(configPath, 'utf-8');
        const userConfig = JSON.parse(content);
        return mergeConfig(userConfig);
    }
    catch {
        return DEFAULT_CONFIG;
    }
}
//# sourceMappingURL=config.js.map