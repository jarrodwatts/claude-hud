import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { getHudPluginDir } from './claude-config-dir.js';
import type { Language } from './i18n/types.js';

export type LineLayoutType = 'compact' | 'expanded';

export type AutocompactBufferMode = 'enabled' | 'disabled';
export type ContextValueMode = 'percent' | 'tokens' | 'remaining' | 'both';
export type GitBranchOverflowMode = 'truncate' | 'wrap';

/**
 * Controls how the model name is displayed in the HUD badge.
 *
 *   full:    Show the raw display name as-is (e.g. "Opus 4.6 (1M context)")
 *   compact: Strip redundant context-window suffix (e.g. "Opus 4.6")
 *   short:   Strip context suffix AND "Claude " prefix (e.g. "Opus 4.6")
 */
export type ModelFormatMode = 'full' | 'compact' | 'short';
export type TimeFormatMode = 'relative' | 'absolute' | 'both';
export type HudElement = 'project' | 'context' | 'usage' | 'promptCache' | 'memory' | 'environment' | 'tools' | 'agents' | 'todos';
export type HudColorName =
  | 'dim'
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
  model: HudColorValue;
  project: HudColorValue;
  git: HudColorValue;
  gitBranch: HudColorValue;
  label: HudColorValue;
  custom: HudColorValue;
}

export const DEFAULT_ELEMENT_ORDER: HudElement[] = [
  'project',
  'context',
  'usage',
  'promptCache',
  'memory',
  'environment',
  'tools',
  'agents',
  'todos',
];

export const DEFAULT_MERGE_GROUPS: HudElement[][] = [
  ['context', 'usage'],
];

const KNOWN_ELEMENTS = new Set<HudElement>(DEFAULT_ELEMENT_ORDER);

export interface HudConfig {
  language: Language;
  lineLayout: LineLayoutType;
  showSeparators: boolean;
  pathLevels: 1 | 2 | 3;
  maxWidth: number | null;
  elementOrder: HudElement[];
  gitStatus: {
    enabled: boolean;
    showDirty: boolean;
    showAheadBehind: boolean;
    showFileStats: boolean;
    branchOverflow: GitBranchOverflowMode;
    pushWarningThreshold: number;
    pushCriticalThreshold: number;
  };
  display: {
    showModel: boolean;
    showProject: boolean;
    showContextBar: boolean;
    contextValue: ContextValueMode;
    showConfigCounts: boolean;
    showCost: boolean;
    showDuration: boolean;
    showSpeed: boolean;
    showTokenBreakdown: boolean;
    showUsage: boolean;
    usageBarEnabled: boolean;
    showResetLabel: boolean;
    usageCompact: boolean;
    showTools: boolean;
    showAgents: boolean;
    showTodos: boolean;
    showSessionName: boolean;
    showClaudeCodeVersion: boolean;
    showEffortLevel: boolean;
    showMemoryUsage: boolean;
    showPromptCache: boolean;
    promptCacheTtlSeconds: number;
    showSessionTokens: boolean;
    showOutputStyle: boolean;
    mergeGroups: HudElement[][];
    autocompactBuffer: AutocompactBufferMode;
    contextWarningThreshold: number;
    contextCriticalThreshold: number;
    usageThreshold: number;
    sevenDayThreshold: number;
    environmentThreshold: number;
    externalUsagePath: string;
    externalUsageFreshnessMs: number;
    modelFormat: ModelFormatMode;
    modelOverride: string;
    customLine: string;
    timeFormat: TimeFormatMode;
  };
  colors: HudColorOverrides;
}

export const DEFAULT_CONFIG: HudConfig = {
  language: 'en',
  lineLayout: 'expanded',
  showSeparators: false,
  pathLevels: 1,
  maxWidth: null,
  elementOrder: [...DEFAULT_ELEMENT_ORDER],
  gitStatus: {
    enabled: true,
    showDirty: true,
    showAheadBehind: false,
    showFileStats: false,
    branchOverflow: 'truncate',
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
    showResetLabel: true,
    usageCompact: false,
    showTools: false,
    showAgents: false,
    showTodos: false,
    showSessionName: false,
    showClaudeCodeVersion: false,
    showEffortLevel: false,
    showMemoryUsage: false,
    showPromptCache: false,
    promptCacheTtlSeconds: 300,
    showSessionTokens: false,
    showOutputStyle: false,
    mergeGroups: DEFAULT_MERGE_GROUPS.map(group => [...group]),
    autocompactBuffer: 'enabled',
    contextWarningThreshold: 70,
    contextCriticalThreshold: 85,
    usageThreshold: 0,
    sevenDayThreshold: 80,
    environmentThreshold: 0,
    externalUsagePath: '',
    externalUsageFreshnessMs: 300000,
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

function validateGitBranchOverflow(value: unknown): value is GitBranchOverflowMode {
  return value === 'truncate' || value === 'wrap';
}

function validateContextValue(value: unknown): value is ContextValueMode {
  return value === 'percent' || value === 'tokens' || value === 'remaining' || value === 'both';
}

function validateLanguage(value: unknown): value is Language {
  return value === 'en' || value === 'zh';
}

function validateModelFormat(value: unknown): value is ModelFormatMode {
  return value === 'full' || value === 'compact' || value === 'short';
}

function validateTimeFormat(value: unknown): value is TimeFormatMode {
  return value === 'relative' || value === 'absolute' || value === 'both';
}

function validateColorName(value: unknown): value is HudColorName {
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

function validateMergeGroups(value: unknown): HudElement[][] {
  if (!Array.isArray(value)) {
    return DEFAULT_MERGE_GROUPS.map(group => [...group]);
  }

  if (value.length === 0) {
    return [];
  }

  const usedElements = new Set<HudElement>();
  const mergeGroups: HudElement[][] = [];

  for (const group of value) {
    if (!Array.isArray(group)) {
      continue;
    }

    const seenInGroup = new Set<HudElement>();
    const normalizedGroup: HudElement[] = [];
    const pendingElements: HudElement[] = [];

    for (const item of group) {
      if (typeof item !== 'string' || !KNOWN_ELEMENTS.has(item as HudElement)) {
        continue;
      }

      const element = item as HudElement;
      if (seenInGroup.has(element) || usedElements.has(element)) {
        continue;
      }

      seenInGroup.add(element);
      normalizedGroup.push(element);
      pendingElements.push(element);
    }

    if (normalizedGroup.length >= 2) {
      for (const element of pendingElements) {
        usedElements.add(element);
      }
      mergeGroups.push(normalizedGroup);
    }
  }

  return mergeGroups.length > 0
    ? mergeGroups
    : DEFAULT_MERGE_GROUPS.map(group => [...group]);
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

function validateContextThreshold(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(100, value));
}

function validateCountThreshold(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

function validateDurationSeconds(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function validateOptionalPath(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function validateFreshnessMs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_CONFIG.display.externalUsageFreshnessMs;
  }
  return Math.max(0, Math.floor(value));
}

export function mergeConfig(userConfig: Partial<HudConfig>): HudConfig {
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

  const rawMaxWidth = (migrated as Record<string, unknown>).maxWidth;
  const maxWidth = (typeof rawMaxWidth === 'number' && Number.isFinite(rawMaxWidth) && rawMaxWidth > 0)
    ? Math.floor(rawMaxWidth)
    : null;

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
    branchOverflow: validateGitBranchOverflow(migrated.gitStatus?.branchOverflow)
      ? migrated.gitStatus.branchOverflow
      : DEFAULT_CONFIG.gitStatus.branchOverflow,
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
    showResetLabel: typeof migrated.display?.showResetLabel === 'boolean'
      ? migrated.display.showResetLabel
      : DEFAULT_CONFIG.display.showResetLabel,
    usageCompact: typeof migrated.display?.usageCompact === 'boolean'
      ? migrated.display.usageCompact
      : DEFAULT_CONFIG.display.usageCompact,
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
    showEffortLevel: typeof migrated.display?.showEffortLevel === 'boolean'
      ? migrated.display.showEffortLevel
      : DEFAULT_CONFIG.display.showEffortLevel,
    showMemoryUsage: typeof migrated.display?.showMemoryUsage === 'boolean'
      ? migrated.display.showMemoryUsage
      : DEFAULT_CONFIG.display.showMemoryUsage,
    showPromptCache: typeof migrated.display?.showPromptCache === 'boolean'
      ? migrated.display.showPromptCache
      : DEFAULT_CONFIG.display.showPromptCache,
    promptCacheTtlSeconds: validateDurationSeconds(
      migrated.display?.promptCacheTtlSeconds,
      DEFAULT_CONFIG.display.promptCacheTtlSeconds,
    ),
    showSessionTokens: typeof migrated.display?.showSessionTokens === 'boolean'
      ? migrated.display.showSessionTokens
      : DEFAULT_CONFIG.display.showSessionTokens,
    showOutputStyle: typeof migrated.display?.showOutputStyle === 'boolean'
      ? migrated.display.showOutputStyle
      : DEFAULT_CONFIG.display.showOutputStyle,
    mergeGroups: validateMergeGroups(migrated.display?.mergeGroups),
    autocompactBuffer: validateAutocompactBuffer(migrated.display?.autocompactBuffer)
      ? migrated.display.autocompactBuffer
      : DEFAULT_CONFIG.display.autocompactBuffer,
    contextWarningThreshold: validateContextThreshold(
      migrated.display?.contextWarningThreshold,
      DEFAULT_CONFIG.display.contextWarningThreshold,
    ),
    contextCriticalThreshold: validateContextThreshold(
      migrated.display?.contextCriticalThreshold,
      DEFAULT_CONFIG.display.contextCriticalThreshold,
    ),
    usageThreshold: validateThreshold(migrated.display?.usageThreshold, 100),
    sevenDayThreshold: validateThreshold(migrated.display?.sevenDayThreshold, 100),
    environmentThreshold: validateThreshold(migrated.display?.environmentThreshold, 100),
    externalUsagePath: validateOptionalPath(migrated.display?.externalUsagePath),
    externalUsageFreshnessMs: validateFreshnessMs(migrated.display?.externalUsageFreshnessMs),
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

  return { language, lineLayout, showSeparators, pathLevels, maxWidth, elementOrder, gitStatus, display, colors };
}

export async function loadConfig(): Promise<HudConfig> {
  const configPath = getConfigPath();

  try {
    if (!fs.existsSync(configPath)) {
      return mergeConfig({});
    }

    const content = fs.readFileSync(configPath, 'utf-8');
    const userConfig = JSON.parse(content) as Partial<HudConfig>;
    return mergeConfig(userConfig);
  } catch {
    return mergeConfig({});
  }
}
