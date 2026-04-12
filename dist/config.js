import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { getHudPluginDir } from './claude-config-dir.js';
export const DEFAULT_ELEMENT_ORDER = [
    'project',
    'context',
    'usage',
    'memory',
    'environment',
    'tools',
    'agents',
    'todos',
];
const KNOWN_ELEMENTS = new Set(DEFAULT_ELEMENT_ORDER);
export const DEFAULT_CONFIG = {
    language: 'en',
    lineLayout: 'expanded',
    showSeparators: false,
    pathLevels: 1,
    elementOrder: [...DEFAULT_ELEMENT_ORDER],
    gitStatus: {
        enabled: true,
        showDirty: true,
        showAheadBehind: false,
        showFileStats: false,
        pushWarningThreshold: 0,
        pushCriticalThreshold: 0,
    },
    display: {
        showModel: true,
        showProject: true,
        showContextBar: true,
        contextValue: 'percent',
        showConfigCounts: false,
        showCost: false,
        showDuration: false,
        showSpeed: false,
        showTokenBreakdown: true,
        showUsage: true,
        usageBarEnabled: true,
        showTools: false,
        showAgents: false,
        showTodos: false,
        showSessionName: false,
        showClaudeCodeVersion: false,
        showMemoryUsage: false,
        showSessionTokens: false,
        showOutputStyle: false,
        autocompactBuffer: 'enabled',
        usageThreshold: 0,
        sevenDayThreshold: 80,
        environmentThreshold: 0,
        modelFormat: 'full',
        modelOverride: '',
        customLine: '',
        timeFormat: 'relative',
    },
    colors: {
        context: 'green',
        usage: 'brightBlue',
        warning: 'yellow',
        usageWarning: 'brightMagenta',
        critical: 'red',
        model: 'cyan',
        project: 'yellow',
        git: 'magenta',
        gitBranch: 'cyan',
        label: 'dim',
        custom: 208,
    },
};
export function getConfigPath() {
    const homeDir = os.homedir();
    return path.join(getHudPluginDir(homeDir), 'config.json');
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
function validateContextValue(value) {
    return value === 'percent' || value === 'tokens' || value === 'remaining' || value === 'both';
}
function validateLanguage(value) {
    return value === 'en' || value === 'zh';
}
function validateModelFormat(value) {
    return value === 'full' || value === 'compact' || value === 'short';
}
function validateTimeFormat(value) {
    return value === 'relative' || value === 'absolute' || value === 'both';
}
function validateColorName(value) {
    return value === 'dim'
        || value === 'red'
        || value === 'green'
        || value === 'yellow'
        || value === 'magenta'
        || value === 'cyan'
        || value === 'brightBlue'
        || value === 'brightMagenta';
}
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
function validateColorValue(value) {
    if (validateColorName(value))
        return true;
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255)
        return true;
    if (typeof value === 'string' && HEX_COLOR_PATTERN.test(value))
        return true;
    return false;
}
function validateElementOrder(value) {
    if (!Array.isArray(value) || value.length === 0) {
        return [...DEFAULT_ELEMENT_ORDER];
    }
    const seen = new Set();
    const elementOrder = [];
    for (const item of value) {
        if (typeof item !== 'string' || !KNOWN_ELEMENTS.has(item)) {
            continue;
        }
        const element = item;
        if (seen.has(element)) {
            continue;
        }
        seen.add(element);
        elementOrder.push(element);
    }
    return elementOrder.length > 0 ? elementOrder : [...DEFAULT_ELEMENT_ORDER];
}
function migrateConfig(userConfig) {
    const migrated = { ...userConfig };
    if ('layout' in userConfig && !('lineLayout' in userConfig)) {
        if (typeof userConfig.layout === 'string') {
            // Legacy string migration (v0.0.x → v0.1.x)
            if (userConfig.layout === 'separators') {
                migrated.lineLayout = 'compact';
                migrated.showSeparators = true;
            }
            else {
                migrated.lineLayout = 'compact';
                migrated.showSeparators = false;
            }
        }
        else if (typeof userConfig.layout === 'object' && userConfig.layout !== null) {
            // Object layout written by third-party tools — extract nested fields
            const obj = userConfig.layout;
            if (typeof obj.lineLayout === 'string')
                migrated.lineLayout = obj.lineLayout;
            if (typeof obj.showSeparators === 'boolean')
                migrated.showSeparators = obj.showSeparators;
            if (typeof obj.pathLevels === 'number')
                migrated.pathLevels = obj.pathLevels;
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
function validateCountThreshold(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return 0;
    }
    return Math.max(0, Math.floor(value));
}
export function mergeConfig(userConfig) {
    const migrated = migrateConfig(userConfig);
    const language = validateLanguage(migrated.language)
        ? migrated.language
        : DEFAULT_CONFIG.language;
    const lineLayout = validateLineLayout(migrated.lineLayout)
        ? migrated.lineLayout
        : DEFAULT_CONFIG.lineLayout;
    const showSeparators = typeof migrated.showSeparators === 'boolean'
        ? migrated.showSeparators
        : DEFAULT_CONFIG.showSeparators;
    const pathLevels = validatePathLevels(migrated.pathLevels)
        ? migrated.pathLevels
        : DEFAULT_CONFIG.pathLevels;
    const elementOrder = validateElementOrder(migrated.elementOrder);
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
        pushWarningThreshold: validateCountThreshold(migrated.gitStatus?.pushWarningThreshold),
        pushCriticalThreshold: validateCountThreshold(migrated.gitStatus?.pushCriticalThreshold),
    };
    const display = {
        showModel: typeof migrated.display?.showModel === 'boolean'
            ? migrated.display.showModel
            : DEFAULT_CONFIG.display.showModel,
        showProject: typeof migrated.display?.showProject === 'boolean'
            ? migrated.display.showProject
            : DEFAULT_CONFIG.display.showProject,
        showContextBar: typeof migrated.display?.showContextBar === 'boolean'
            ? migrated.display.showContextBar
            : DEFAULT_CONFIG.display.showContextBar,
        contextValue: validateContextValue(migrated.display?.contextValue)
            ? migrated.display.contextValue
            : DEFAULT_CONFIG.display.contextValue,
        showConfigCounts: typeof migrated.display?.showConfigCounts === 'boolean'
            ? migrated.display.showConfigCounts
            : DEFAULT_CONFIG.display.showConfigCounts,
        showCost: typeof migrated.display?.showCost === 'boolean'
            ? migrated.display.showCost
            : DEFAULT_CONFIG.display.showCost,
        showDuration: typeof migrated.display?.showDuration === 'boolean'
            ? migrated.display.showDuration
            : DEFAULT_CONFIG.display.showDuration,
        showSpeed: typeof migrated.display?.showSpeed === 'boolean'
            ? migrated.display.showSpeed
            : DEFAULT_CONFIG.display.showSpeed,
        showTokenBreakdown: typeof migrated.display?.showTokenBreakdown === 'boolean'
            ? migrated.display.showTokenBreakdown
            : DEFAULT_CONFIG.display.showTokenBreakdown,
        showUsage: typeof migrated.display?.showUsage === 'boolean'
            ? migrated.display.showUsage
            : DEFAULT_CONFIG.display.showUsage,
        usageBarEnabled: typeof migrated.display?.usageBarEnabled === 'boolean'
            ? migrated.display.usageBarEnabled
            : DEFAULT_CONFIG.display.usageBarEnabled,
        showTools: typeof migrated.display?.showTools === 'boolean'
            ? migrated.display.showTools
            : DEFAULT_CONFIG.display.showTools,
        showAgents: typeof migrated.display?.showAgents === 'boolean'
            ? migrated.display.showAgents
            : DEFAULT_CONFIG.display.showAgents,
        showTodos: typeof migrated.display?.showTodos === 'boolean'
            ? migrated.display.showTodos
            : DEFAULT_CONFIG.display.showTodos,
        showSessionName: typeof migrated.display?.showSessionName === 'boolean'
            ? migrated.display.showSessionName
            : DEFAULT_CONFIG.display.showSessionName,
        showClaudeCodeVersion: typeof migrated.display?.showClaudeCodeVersion === 'boolean'
            ? migrated.display.showClaudeCodeVersion
            : DEFAULT_CONFIG.display.showClaudeCodeVersion,
        showMemoryUsage: typeof migrated.display?.showMemoryUsage === 'boolean'
            ? migrated.display.showMemoryUsage
            : DEFAULT_CONFIG.display.showMemoryUsage,
        showSessionTokens: typeof migrated.display?.showSessionTokens === 'boolean'
            ? migrated.display.showSessionTokens
            : DEFAULT_CONFIG.display.showSessionTokens,
        showOutputStyle: typeof migrated.display?.showOutputStyle === 'boolean'
            ? migrated.display.showOutputStyle
            : DEFAULT_CONFIG.display.showOutputStyle,
        autocompactBuffer: validateAutocompactBuffer(migrated.display?.autocompactBuffer)
            ? migrated.display.autocompactBuffer
            : DEFAULT_CONFIG.display.autocompactBuffer,
        usageThreshold: validateThreshold(migrated.display?.usageThreshold, 100),
        sevenDayThreshold: validateThreshold(migrated.display?.sevenDayThreshold, 100),
        environmentThreshold: validateThreshold(migrated.display?.environmentThreshold, 100),
        modelFormat: validateModelFormat(migrated.display?.modelFormat)
            ? migrated.display.modelFormat
            : DEFAULT_CONFIG.display.modelFormat,
        modelOverride: typeof migrated.display?.modelOverride === 'string'
            ? migrated.display.modelOverride.slice(0, 80)
            : DEFAULT_CONFIG.display.modelOverride,
        customLine: typeof migrated.display?.customLine === 'string'
            ? migrated.display.customLine.slice(0, 80)
            : DEFAULT_CONFIG.display.customLine,
        timeFormat: validateTimeFormat(migrated.display?.timeFormat)
            ? migrated.display.timeFormat
            : DEFAULT_CONFIG.display.timeFormat,
    };
    const colors = {
        context: validateColorValue(migrated.colors?.context)
            ? migrated.colors.context
            : DEFAULT_CONFIG.colors.context,
        usage: validateColorValue(migrated.colors?.usage)
            ? migrated.colors.usage
            : DEFAULT_CONFIG.colors.usage,
        warning: validateColorValue(migrated.colors?.warning)
            ? migrated.colors.warning
            : DEFAULT_CONFIG.colors.warning,
        usageWarning: validateColorValue(migrated.colors?.usageWarning)
            ? migrated.colors.usageWarning
            : DEFAULT_CONFIG.colors.usageWarning,
        critical: validateColorValue(migrated.colors?.critical)
            ? migrated.colors.critical
            : DEFAULT_CONFIG.colors.critical,
        model: validateColorValue(migrated.colors?.model)
            ? migrated.colors.model
            : DEFAULT_CONFIG.colors.model,
        project: validateColorValue(migrated.colors?.project)
            ? migrated.colors.project
            : DEFAULT_CONFIG.colors.project,
        git: validateColorValue(migrated.colors?.git)
            ? migrated.colors.git
            : DEFAULT_CONFIG.colors.git,
        gitBranch: validateColorValue(migrated.colors?.gitBranch)
            ? migrated.colors.gitBranch
            : DEFAULT_CONFIG.colors.gitBranch,
        label: validateColorValue(migrated.colors?.label)
            ? migrated.colors.label
            : DEFAULT_CONFIG.colors.label,
        custom: validateColorValue(migrated.colors?.custom)
            ? migrated.colors.custom
            : DEFAULT_CONFIG.colors.custom,
    };
    return { language, lineLayout, showSeparators, pathLevels, elementOrder, gitStatus, display, colors };
}
export async function loadConfig() {
    const configPath = getConfigPath();
    try {
        if (!fs.existsSync(configPath)) {
            return mergeConfig({});
        }
        const content = fs.readFileSync(configPath, 'utf-8');
        const userConfig = JSON.parse(content);
        return mergeConfig(userConfig);
    }
    catch {
        return mergeConfig({});
    }
}
//# sourceMappingURL=config.js.map