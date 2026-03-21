import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { getHudPluginDir } from './claude-config-dir.js';
export const DEFAULT_ELEMENT_ORDER = [
    'project', 'context', 'usage', 'environment', 'framework', 'tools', 'agents', 'todos', 'alert',
];
const KNOWN_ELEMENTS = new Set(DEFAULT_ELEMENT_ORDER);
export const DEFAULT_CONFIG = {
    lineLayout: 'expanded',
    showSeparators: false,
    pathLevels: 1,
    elementOrder: [...DEFAULT_ELEMENT_ORDER],
    gitStatus: {
        enabled: true,
        showDirty: true,
        showAheadBehind: false,
        showFileStats: false,
    },
    display: {
        showModel: true,
        showProject: true,
        showContextBar: true,
        contextValue: 'percent',
        showConfigCounts: false,
        showDuration: false,
        showSpeed: false,
        showTokenBreakdown: true,
        showUsage: true,
        usageBarEnabled: true,
        showTools: false,
        showAgents: false,
        showTodos: false,
        showSessionName: false,
        autocompactBuffer: 'enabled',
        usageThreshold: 0,
        sevenDayThreshold: 80,
        environmentThreshold: 0,
        customLine: '',
        showFrameworks: false,
        showBurnRate: false,
        showAlerts: true,
        activityIndicator: true,
        treePrefixes: true,
        mergeToolsAgents: true,
        barStyle: 'classic',
    },
    usage: {
        cacheTtlSeconds: 60,
        failureCacheTtlSeconds: 15,
    },
    colors: {
        context: 'green',
        usage: 'brightBlue',
        warning: 'yellow',
        usageWarning: 'brightMagenta',
        critical: 'red',
    },
    frameworks: {
        agw: { enabled: true, endpoint: 'http://localhost:3000' },
        agentTeams: { enabled: true },
    },
    alerts: {
        context: { warningThreshold: 70, criticalThreshold: 85, actions: { visual: true, bell: false, predict: true } },
        usage5h: { warningThreshold: 70, criticalThreshold: 90, actions: { visual: true, bell: true, predict: true } },
        usage7d: { warningThreshold: 80, actions: { visual: true, bell: false, predict: true } },
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
    return value === 'percent' || value === 'tokens' || value === 'remaining';
}
function validateColorName(value) {
    return value === 'red'
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
function validatePositiveInt(value, defaultValue) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0)
        return defaultValue;
    return value;
}
export function mergeConfig(userConfig) {
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
        autocompactBuffer: validateAutocompactBuffer(migrated.display?.autocompactBuffer)
            ? migrated.display.autocompactBuffer
            : DEFAULT_CONFIG.display.autocompactBuffer,
        usageThreshold: validateThreshold(migrated.display?.usageThreshold, 100),
        sevenDayThreshold: validateThreshold(migrated.display?.sevenDayThreshold, 100),
        environmentThreshold: validateThreshold(migrated.display?.environmentThreshold, 100),
        customLine: typeof migrated.display?.customLine === 'string'
            ? migrated.display.customLine.slice(0, 80)
            : DEFAULT_CONFIG.display.customLine,
        showFrameworks: typeof migrated.display?.showFrameworks === 'boolean'
            ? migrated.display.showFrameworks
            : DEFAULT_CONFIG.display.showFrameworks,
        showBurnRate: typeof migrated.display?.showBurnRate === 'boolean'
            ? migrated.display.showBurnRate
            : DEFAULT_CONFIG.display.showBurnRate,
        showAlerts: typeof migrated.display?.showAlerts === 'boolean'
            ? migrated.display.showAlerts
            : DEFAULT_CONFIG.display.showAlerts,
        activityIndicator: typeof migrated.display?.activityIndicator === 'boolean'
            ? migrated.display.activityIndicator
            : DEFAULT_CONFIG.display.activityIndicator,
        treePrefixes: typeof migrated.display?.treePrefixes === 'boolean'
            ? migrated.display.treePrefixes
            : DEFAULT_CONFIG.display.treePrefixes,
        mergeToolsAgents: typeof migrated.display?.mergeToolsAgents === 'boolean'
            ? migrated.display.mergeToolsAgents
            : DEFAULT_CONFIG.display.mergeToolsAgents,
        barStyle: (migrated.display?.barStyle === 'classic' || migrated.display?.barStyle === 'modern')
            ? migrated.display.barStyle
            : DEFAULT_CONFIG.display.barStyle,
    };
    const usage = {
        cacheTtlSeconds: validatePositiveInt(migrated.usage?.cacheTtlSeconds, DEFAULT_CONFIG.usage.cacheTtlSeconds),
        failureCacheTtlSeconds: validatePositiveInt(migrated.usage?.failureCacheTtlSeconds, DEFAULT_CONFIG.usage.failureCacheTtlSeconds),
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
    };
    const frameworks = {
        agw: {
            enabled: typeof migrated.frameworks?.agw?.enabled === 'boolean'
                ? migrated.frameworks.agw.enabled
                : DEFAULT_CONFIG.frameworks.agw.enabled,
            endpoint: typeof migrated.frameworks?.agw?.endpoint === 'string'
                ? migrated.frameworks.agw.endpoint
                : DEFAULT_CONFIG.frameworks.agw.endpoint,
        },
        agentTeams: {
            enabled: typeof migrated.frameworks?.agentTeams?.enabled === 'boolean'
                ? migrated.frameworks.agentTeams.enabled
                : DEFAULT_CONFIG.frameworks.agentTeams.enabled,
        },
    };
    function mergeAlertThreshold(value, defaultValue) {
        if (typeof value === 'number' && value >= 0 && value <= 100)
            return value;
        return defaultValue;
    }
    function mergeAlertActions(userActions, defaultActions) {
        return {
            visual: typeof userActions?.visual === 'boolean' ? userActions.visual : defaultActions.visual,
            bell: typeof userActions?.bell === 'boolean' ? userActions.bell : defaultActions.bell,
            predict: typeof userActions?.predict === 'boolean' ? userActions.predict : defaultActions.predict,
        };
    }
    const alerts = {
        context: {
            warningThreshold: mergeAlertThreshold(migrated.alerts?.context?.warningThreshold, DEFAULT_CONFIG.alerts.context.warningThreshold),
            criticalThreshold: mergeAlertThreshold(migrated.alerts?.context?.criticalThreshold, DEFAULT_CONFIG.alerts.context.criticalThreshold),
            actions: mergeAlertActions(migrated.alerts?.context?.actions, DEFAULT_CONFIG.alerts.context.actions),
        },
        usage5h: {
            warningThreshold: mergeAlertThreshold(migrated.alerts?.usage5h?.warningThreshold, DEFAULT_CONFIG.alerts.usage5h.warningThreshold),
            criticalThreshold: mergeAlertThreshold(migrated.alerts?.usage5h?.criticalThreshold, DEFAULT_CONFIG.alerts.usage5h.criticalThreshold),
            actions: mergeAlertActions(migrated.alerts?.usage5h?.actions, DEFAULT_CONFIG.alerts.usage5h.actions),
        },
        usage7d: {
            warningThreshold: mergeAlertThreshold(migrated.alerts?.usage7d?.warningThreshold, DEFAULT_CONFIG.alerts.usage7d.warningThreshold),
            actions: mergeAlertActions(migrated.alerts?.usage7d?.actions, DEFAULT_CONFIG.alerts.usage7d.actions),
        },
    };
    return { lineLayout, showSeparators, pathLevels, elementOrder, gitStatus, display, usage, colors, frameworks, alerts };
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