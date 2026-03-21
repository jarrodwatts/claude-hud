import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { getHudPluginDir } from './claude-config-dir.js';
import type { AlertAction } from './types.js';
import { getTheme } from './themes.js';

export type LineLayoutType = 'compact' | 'expanded';

export type AutocompactBufferMode = 'enabled' | 'disabled';
export type ContextValueMode = 'percent' | 'tokens' | 'remaining';
export type HudElement = 'project' | 'context' | 'usage' | 'environment' | 'framework' | 'tools' | 'agents' | 'todos' | 'alert';
export type HudColorName =
  | 'red'
  | 'green'
  | 'yellow'
  | 'magenta'
  | 'cyan'
  | 'brightBlue'
  | 'brightMagenta';

/** A color value: named preset, 256-color index (0-255), or hex string (#rrggbb). */
export type HudColorValue = HudColorName | number | string;

export interface HudColorOverrides {
  context: HudColorValue;
  usage: HudColorValue;
  warning: HudColorValue;
  usageWarning: HudColorValue;
  critical: HudColorValue;
}

export const DEFAULT_ELEMENT_ORDER: HudElement[] = [
  'project', 'context', 'usage', 'environment', 'framework', 'tools', 'agents', 'todos', 'alert',
];

const KNOWN_ELEMENTS = new Set<HudElement>(DEFAULT_ELEMENT_ORDER);

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
    showCost: boolean;
    showNotifications: boolean;
  };
  theme: string;
  usage: {
    cacheTtlSeconds: number;
    failureCacheTtlSeconds: number;
  };
  colors: HudColorOverrides;
  frameworks: {
    agw: { enabled: boolean; endpoint: string };
    agentTeams: { enabled: boolean };
  };
  alerts: {
    context: { warningThreshold: number; criticalThreshold: number; actions: AlertAction };
    usage5h: { warningThreshold: number; criticalThreshold: number; actions: AlertAction };
    usage7d: { warningThreshold: number; actions: AlertAction };
  };
}

export const DEFAULT_CONFIG: HudConfig = {
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
    barStyle: 'classic' as const,
    showCost: false,
    showNotifications: false,
  },
  theme: 'default',
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

export function getConfigPath(): string {
  const homeDir = os.homedir();
  return path.join(getHudPluginDir(homeDir), 'config.json');
}

function validatePathLevels(value: unknown): value is 1 | 2 | 3 {
  return value === 1 || value === 2 || value === 3;
}

function validateLineLayout(value: unknown): value is LineLayoutType {
  return value === 'compact' || value === 'expanded';
}

function validateAutocompactBuffer(value: unknown): value is AutocompactBufferMode {
  return value === 'enabled' || value === 'disabled';
}

function validateContextValue(value: unknown): value is ContextValueMode {
  return value === 'percent' || value === 'tokens' || value === 'remaining';
}

function validateColorName(value: unknown): value is HudColorName {
  return value === 'red'
    || value === 'green'
    || value === 'yellow'
    || value === 'magenta'
    || value === 'cyan'
    || value === 'brightBlue'
    || value === 'brightMagenta';
}

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

function validateColorValue(value: unknown): value is HudColorValue {
  if (validateColorName(value)) return true;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255) return true;
  if (typeof value === 'string' && HEX_COLOR_PATTERN.test(value)) return true;
  return false;
}

function validateElementOrder(value: unknown): HudElement[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [...DEFAULT_ELEMENT_ORDER];
  }

  const seen = new Set<HudElement>();
  const elementOrder: HudElement[] = [];

  for (const item of value) {
    if (typeof item !== 'string' || !KNOWN_ELEMENTS.has(item as HudElement)) {
      continue;
    }

    const element = item as HudElement;
    if (seen.has(element)) {
      continue;
    }

    seen.add(element);
    elementOrder.push(element);
  }

  return elementOrder.length > 0 ? elementOrder : [...DEFAULT_ELEMENT_ORDER];
}

interface LegacyConfig {
  layout?: 'default' | 'separators' | Record<string, unknown>;
}

function migrateConfig(userConfig: Partial<HudConfig> & LegacyConfig): Partial<HudConfig> {
  const migrated = { ...userConfig } as Partial<HudConfig> & LegacyConfig;

  if ('layout' in userConfig && !('lineLayout' in userConfig)) {
    if (typeof userConfig.layout === 'string') {
      // Legacy string migration (v0.0.x → v0.1.x)
      if (userConfig.layout === 'separators') {
        migrated.lineLayout = 'compact';
        migrated.showSeparators = true;
      } else {
        migrated.lineLayout = 'compact';
        migrated.showSeparators = false;
      }
    } else if (typeof userConfig.layout === 'object' && userConfig.layout !== null) {
      // Object layout written by third-party tools — extract nested fields
      const obj = userConfig.layout as Record<string, unknown>;
      if (typeof obj.lineLayout === 'string') migrated.lineLayout = obj.lineLayout as any;
      if (typeof obj.showSeparators === 'boolean') migrated.showSeparators = obj.showSeparators;
      if (typeof obj.pathLevels === 'number') migrated.pathLevels = obj.pathLevels as any;
    }
    delete migrated.layout;
  }

  return migrated;
}

function validateThreshold(value: unknown, max = 100): number {
  if (typeof value !== 'number') return 0;
  return Math.max(0, Math.min(max, value));
}

function validatePositiveInt(value: unknown, defaultValue: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return defaultValue;
  return value;
}

export function mergeConfig(userConfig: Partial<HudConfig>): HudConfig {
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
    showCost: typeof migrated.display?.showCost === 'boolean'
      ? migrated.display.showCost
      : DEFAULT_CONFIG.display.showCost,
    showNotifications: typeof migrated.display?.showNotifications === 'boolean'
      ? migrated.display.showNotifications
      : DEFAULT_CONFIG.display.showNotifications,
  };

  const usage = {
    cacheTtlSeconds: validatePositiveInt(
      migrated.usage?.cacheTtlSeconds,
      DEFAULT_CONFIG.usage.cacheTtlSeconds
    ),
    failureCacheTtlSeconds: validatePositiveInt(
      migrated.usage?.failureCacheTtlSeconds,
      DEFAULT_CONFIG.usage.failureCacheTtlSeconds
    ),
  };

  const theme = typeof migrated.theme === 'string' ? migrated.theme : DEFAULT_CONFIG.theme;

  // Start with default colors
  const defaultColors = { ...DEFAULT_CONFIG.colors };

  // Apply theme colors as base (if a valid theme is set)
  const resolvedTheme = getTheme(theme);
  const themeColors = resolvedTheme ? { ...resolvedTheme.colors } : defaultColors;

  // User's explicit color overrides take precedence over theme
  const colors = {
    context: validateColorValue(migrated.colors?.context)
      ? migrated.colors.context
      : themeColors.context,
    usage: validateColorValue(migrated.colors?.usage)
      ? migrated.colors.usage
      : themeColors.usage,
    warning: validateColorValue(migrated.colors?.warning)
      ? migrated.colors.warning
      : themeColors.warning,
    usageWarning: validateColorValue(migrated.colors?.usageWarning)
      ? migrated.colors.usageWarning
      : themeColors.usageWarning,
    critical: validateColorValue(migrated.colors?.critical)
      ? migrated.colors.critical
      : themeColors.critical,
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

  function mergeAlertThreshold(value: unknown, defaultValue: number): number {
    if (typeof value === 'number' && value >= 0 && value <= 100) return value;
    return defaultValue;
  }

  function mergeAlertActions(userActions: Partial<AlertAction> | undefined, defaultActions: AlertAction): AlertAction {
    return {
      visual: typeof userActions?.visual === 'boolean' ? userActions.visual : defaultActions.visual,
      bell: typeof userActions?.bell === 'boolean' ? userActions.bell : defaultActions.bell,
      predict: typeof userActions?.predict === 'boolean' ? userActions.predict : defaultActions.predict,
    };
  }

  const alerts = {
    context: {
      warningThreshold: mergeAlertThreshold(
        migrated.alerts?.context?.warningThreshold,
        DEFAULT_CONFIG.alerts.context.warningThreshold
      ),
      criticalThreshold: mergeAlertThreshold(
        migrated.alerts?.context?.criticalThreshold,
        DEFAULT_CONFIG.alerts.context.criticalThreshold
      ),
      actions: mergeAlertActions(migrated.alerts?.context?.actions, DEFAULT_CONFIG.alerts.context.actions),
    },
    usage5h: {
      warningThreshold: mergeAlertThreshold(
        migrated.alerts?.usage5h?.warningThreshold,
        DEFAULT_CONFIG.alerts.usage5h.warningThreshold
      ),
      criticalThreshold: mergeAlertThreshold(
        migrated.alerts?.usage5h?.criticalThreshold,
        DEFAULT_CONFIG.alerts.usage5h.criticalThreshold
      ),
      actions: mergeAlertActions(migrated.alerts?.usage5h?.actions, DEFAULT_CONFIG.alerts.usage5h.actions),
    },
    usage7d: {
      warningThreshold: mergeAlertThreshold(
        migrated.alerts?.usage7d?.warningThreshold,
        DEFAULT_CONFIG.alerts.usage7d.warningThreshold
      ),
      actions: mergeAlertActions(migrated.alerts?.usage7d?.actions, DEFAULT_CONFIG.alerts.usage7d.actions),
    },
  };

  return { lineLayout, showSeparators, pathLevels, elementOrder, gitStatus, display, theme, usage, colors, frameworks, alerts };
}

export async function loadConfig(): Promise<HudConfig> {
  const configPath = getConfigPath();

  try {
    if (!fs.existsSync(configPath)) {
      return DEFAULT_CONFIG;
    }

    const content = fs.readFileSync(configPath, 'utf-8');
    const userConfig = JSON.parse(content) as Partial<HudConfig>;
    return mergeConfig(userConfig);
  } catch {
    return DEFAULT_CONFIG;
  }
}
