import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { expandHomeDirPrefix, getClaudeConfigDir, getHudPluginDir } from './claude-config-dir.js';
import { createDebug } from './debug.js';
import type { Language } from './i18n/types.js';
import { MAX_TERMINAL_WIDTH } from './utils/terminal.js';
import { sanitizeDisplayText } from './utils/sanitize.js';

const debug = createDebug('config');
const MAX_CONFIG_FILE_BYTES = 64 * 1024;
const MAX_CONFIG_NESTING_DEPTH = 8;
const UNSAFE_CONFIG_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

const LANGUAGES = ['en', 'zh', 'zh-Hans', 'zh-Hant', 'zh-TW'] as const satisfies readonly Language[];
const LINE_LAYOUTS = ['compact', 'expanded'] as const;
const PATH_LEVELS = [1, 2, 3, 'full'] as const;
const CONTEXT_VALUE_MODES = ['percent', 'tokens', 'remaining', 'both'] as const;
const USAGE_VALUE_MODES = ['percent', 'remaining'] as const;
const GIT_BRANCH_OVERFLOW_MODES = ['truncate', 'wrap'] as const;
// full: display name as-is; compact: drop the context-window suffix; short: also drop "Claude ".
const MODEL_FORMATS = ['full', 'compact', 'short'] as const;
const MODEL_SOURCES = ['auto', 'stdin', 'transcript'] as const;
const EFFORT_FORMATS = ['full', 'symbol', 'text'] as const;
const TIME_FORMATS = ['relative', 'absolute', 'both', 'elapsed', 'elapsedAndAbsolute'] as const;
const HOUR_CYCLES = ['auto', 'h11', 'h12', 'h23', 'h24'] as const;
const CUSTOM_LINE_POSITIONS = ['first', 'last'] as const;
const ADDED_DIRS_LAYOUTS = ['inline', 'line'] as const;
const COLOR_NAMES = ['dim', 'red', 'green', 'yellow', 'magenta', 'cyan', 'brightBlue', 'brightMagenta'] as const;

const ELEMENTS = [
  'project',
  'addedDirs',
  'context',
  'usage',
  'promptCache',
  'cacheHitRate',
  'memory',
  'environment',
  'tools',
  'skills',
  'mcp',
  'agents',
  'todos',
  'sessionTime',
] as const;

// Orderable segments of the first line, shared by the expanded and compact layouts.
const FIRST_LINE_SEGMENTS = [
  'model',
  'project',
  'advisor',
  'sessionName',
  'version',
  'extra',
  'duration',
  'cost',
  'speed',
  'auth',
] as const;

export type LineLayoutType = typeof LINE_LAYOUTS[number];
export type PathLevels = typeof PATH_LEVELS[number];
export type ContextValueMode = typeof CONTEXT_VALUE_MODES[number];
export type UsageValueMode = typeof USAGE_VALUE_MODES[number];
export type GitBranchOverflowMode = typeof GIT_BRANCH_OVERFLOW_MODES[number];
export type ModelFormatMode = typeof MODEL_FORMATS[number];
export type EffortFormatMode = typeof EFFORT_FORMATS[number];
export type TimeFormatMode = typeof TIME_FORMATS[number];
export type HourCycleMode = typeof HOUR_CYCLES[number];
export type CustomLinePosition = typeof CUSTOM_LINE_POSITIONS[number];
export type AddedDirsLayout = typeof ADDED_DIRS_LAYOUTS[number];
export type HudColorName = typeof COLOR_NAMES[number];
export type HudElement = typeof ELEMENTS[number];
export type FirstLineSegment = typeof FIRST_LINE_SEGMENTS[number];

/** A named preset, a 256-color index (0-255), or a #rrggbb hex string. */
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

export const DEFAULT_ELEMENT_ORDER: HudElement[] = [...ELEMENTS];
export const DEFAULT_MERGE_GROUPS: HudElement[][] = [['context', 'usage']];
// Empty keeps each renderer's native order until the user moves a segment.
export const DEFAULT_PROJECT_LINE_ORDER: FirstLineSegment[] = [];

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
    showWorktree: boolean;
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
    // Also show cost for routed providers (Bedrock/Vertex), which showCost hides.
    showRoutedCost: boolean;
    showDailyCost: boolean;
    showWeeklyCost: boolean;
    showDuration: boolean;
    showSpeed: boolean;
    showTokenBreakdown: boolean;
    showUsage: boolean;
    usageValue: UsageValueMode;
    usageBarEnabled: boolean;
    showResetLabel: boolean;
    usageCompact: boolean;
    showModelScopedUsage: boolean;
    usagePace: boolean;
    showTools: boolean;
    showSkills: boolean;
    showMcp: boolean;
    toolNameMaxLength: number;
    toolsMaxVisible: number;
    skillsMaxVisible: number;
    showAgents: boolean;
    showTodos: boolean;
    showSessionName: boolean;
    showAuth: boolean;
    showAuthUser: boolean;
    // Max characters of the account name (0 = full).
    authUserLength: number;
    showClaudeCodeVersion: boolean;
    showEffortLevel: boolean;
    effortFormat: EffortFormatMode;
    showMemoryUsage: boolean;
    showPromptCache: boolean;
    showCacheHitRate: boolean;
    showSessionTokens: boolean;
    showOutputStyle: boolean;
    showSessionStartDate: boolean;
    showLastResponseAt: boolean;
    showCompactions: boolean;
    mergeGroups: HudElement[][];
    // Elements pushed to the right edge of a merged line, when it fits and the width is known.
    rightAlign: HudElement[];
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
    // auto: transcript model for non-Claude (proxied) models; stdin/transcript: always that source.
    modelSource: typeof MODEL_SOURCES[number];
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
  };
  colors: HudColorOverrides;
}

export const DEFAULT_CONFIG: HudConfig = {
  language: 'en',
  lineLayout: 'expanded',
  showSeparators: false,
  pathLevels: 1,
  maxWidth: null,
  forceMaxWidth: false,
  elementOrder: [...DEFAULT_ELEMENT_ORDER],
  projectLineOrder: [...DEFAULT_PROJECT_LINE_ORDER],
  gitStatus: {
    enabled: true,
    showDirty: true,
    showAheadBehind: false,
    showFileStats: false,
    showWorktree: false,
    branchOverflow: 'truncate',
    pushWarningThreshold: 0,
    pushCriticalThreshold: 0,
  },
  jjStatus: {
    enabled: false,
    showDirty: true,
    showConflicts: true,
  },
  display: {
    showModel: true,
    showProject: true,
    showAddedDirs: true,
    addedDirsLayout: 'inline',
    showContextBar: true,
    contextValue: 'percent',
    showConfigCounts: false,
    showCost: false,
    showRoutedCost: false,
    showDailyCost: false,
    showWeeklyCost: false,
    showDuration: false,
    showSpeed: false,
    showTokenBreakdown: true,
    showUsage: true,
    usageValue: 'percent',
    usageBarEnabled: true,
    showResetLabel: true,
    usageCompact: false,
    showModelScopedUsage: true,
    usagePace: false,
    showTools: false,
    showSkills: false,
    showMcp: false,
    toolNameMaxLength: 0,
    toolsMaxVisible: 4,
    skillsMaxVisible: 4,
    showAgents: false,
    showTodos: false,
    showSessionName: false,
    showAuth: false,
    showAuthUser: false,
    authUserLength: 8,
    showClaudeCodeVersion: false,
    showEffortLevel: false,
    effortFormat: 'full',
    showMemoryUsage: false,
    showPromptCache: false,
    showCacheHitRate: false,
    showSessionTokens: false,
    showOutputStyle: false,
    showSessionStartDate: false,
    showLastResponseAt: false,
    showCompactions: false,
    mergeGroups: DEFAULT_MERGE_GROUPS.map(group => [...group]),
    rightAlign: [],
    contextWarningThreshold: 70,
    contextCriticalThreshold: 85,
    usageThreshold: 0,
    sevenDayThreshold: 80,
    environmentThreshold: 0,
    externalUsagePath: '',
    externalUsageWritePath: '',
    externalUsageFreshnessMs: 300000,
    modelFormat: 'full',
    modelOverride: '',
    modelSource: 'stdin',
    showProvider: false,
    providerName: '',
    customLine: '',
    customLinePosition: 'last',
    timeFormat: 'relative',
    hourCycle: 'auto',
    showClockSeconds: false,
    showAdvisor: false,
    advisorOverride: '',
    autoCompactWindow: null,
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
    barFilled: '█',
    barEmpty: '░',
  },
};

export function getConfigPath(): string {
  return path.join(getHudPluginDir(os.homedir()), 'config.json');
}

// Lives outside plugins/, which users often symlink across several CLAUDE_CONFIG_DIRs,
// so it stays per-directory and can override the shared config.
export function getConfigOverridePath(): string {
  return path.join(getClaudeConfigDir(os.homedir()), 'claude-hud.json');
}

// A rule maps a raw user value to a valid one, or to the fallback (the default).
type Rule = (value: unknown, fallback: any) => unknown;

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const oneOf = (allowed: readonly unknown[]): Rule => (value, fallback) => (
  allowed.includes(value) ? value : fallback
);
const clamp = (min: number, max: number): Rule => (value, fallback) => (
  isNumber(value) ? Math.max(min, Math.min(max, value)) : fallback
);
const floorAtLeastZero: Rule = (value, fallback) => (isNumber(value) ? Math.max(0, Math.floor(value)) : fallback);
const count: Rule = (value, fallback) => (Number.isInteger(value) && (value as number) >= 0 ? value : fallback);
const text = (maxLength: number): Rule => (value, fallback) => (
  typeof value === 'string' ? sanitizeDisplayText(value).slice(0, maxLength) : fallback
);

// Keeps known names once each, in order. An empty result falls back only when `nonEmpty`.
const names = (known: readonly unknown[], nonEmpty: boolean): Rule => (value, fallback) => {
  if (!Array.isArray(value)) return fallback;
  const kept = [...new Set(value.filter(item => known.includes(item)))];
  return kept.length > 0 || !nonEmpty ? kept : fallback;
};

// Groups need two or more known elements, and an element joins at most one group.
const mergeGroups: Rule = (value, fallback) => {
  if (!Array.isArray(value)) return fallback;
  if (value.length === 0) return [];
  const used = new Set<unknown>();
  const groups: unknown[][] = [];
  for (const group of value) {
    if (!Array.isArray(group)) continue;
    const members = [...new Set(group.filter(item => (ELEMENTS as readonly unknown[]).includes(item) && !used.has(item)))];
    if (members.length < 2) continue;
    members.forEach(member => used.add(member));
    groups.push(members);
  }
  return groups.length > 0 ? groups : fallback;
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const color: Rule = (value, fallback) => (
  COLOR_NAMES.includes(value as HudColorName)
  || (Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 255)
  || (typeof value === 'string' && HEX_COLOR.test(value))
    ? value
    : fallback
);

// Exactly one visible grapheme: no controls, format, variation, separator, or unassigned code points.
const INVISIBLE_CODEPOINT = /[\p{Cc}\p{Cf}\p{Variation_Selector}\p{Zl}\p{Zp}\p{Cn}]/u;
const barChar: Rule = (value, fallback) => {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)];
  return graphemes.length === 1 && !INVISIBLE_CODEPOINT.test(value) ? value : fallback;
};

// Expands a leading ~ and ${VAR}; unset variables are left as written.
const usagePath: Rule = (value) => (
  typeof value === 'string'
    ? expandHomeDirPrefix(value.trim(), os.homedir())
      .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name: string) => process.env[name] ?? match)
    : ''
);

// Booleans need no rule: a default of type boolean accepts only booleans.
const RULES: Record<string, Rule> = {
  'language': oneOf(LANGUAGES),
  'lineLayout': oneOf(LINE_LAYOUTS),
  'pathLevels': oneOf(PATH_LEVELS),
  'maxWidth': (value) => (isNumber(value) && value > 0 ? Math.min(Math.floor(value), MAX_TERMINAL_WIDTH) : null),
  'elementOrder': names(ELEMENTS, true),
  'projectLineOrder': names(FIRST_LINE_SEGMENTS, false),
  'gitStatus.branchOverflow': oneOf(GIT_BRANCH_OVERFLOW_MODES),
  'gitStatus.pushWarningThreshold': floorAtLeastZero,
  'gitStatus.pushCriticalThreshold': floorAtLeastZero,
  'display.addedDirsLayout': oneOf(ADDED_DIRS_LAYOUTS),
  'display.contextValue': oneOf(CONTEXT_VALUE_MODES),
  'display.usageValue': oneOf(USAGE_VALUE_MODES),
  'display.toolNameMaxLength': count,
  'display.toolsMaxVisible': count,
  'display.skillsMaxVisible': count,
  'display.authUserLength': count,
  'display.effortFormat': oneOf(EFFORT_FORMATS),
  'display.mergeGroups': mergeGroups,
  'display.rightAlign': names(ELEMENTS, false),
  'display.contextWarningThreshold': clamp(0, 100),
  'display.contextCriticalThreshold': clamp(0, 100),
  'display.usageThreshold': clamp(0, 100),
  'display.sevenDayThreshold': clamp(0, 100),
  'display.environmentThreshold': clamp(0, 100),
  'display.externalUsagePath': usagePath,
  'display.externalUsageWritePath': usagePath,
  'display.externalUsageFreshnessMs': floorAtLeastZero,
  'display.modelFormat': oneOf(MODEL_FORMATS),
  'display.modelOverride': text(80),
  'display.modelSource': oneOf(MODEL_SOURCES),
  'display.providerName': text(40),
  'display.customLine': text(80),
  'display.customLinePosition': oneOf(CUSTOM_LINE_POSITIONS),
  'display.timeFormat': oneOf(TIME_FORMATS),
  'display.hourCycle': oneOf(HOUR_CYCLES),
  'display.advisorOverride': text(80),
  'display.autoCompactWindow': (value) => (Number.isInteger(value) && (value as number) > 0 ? value : null),
  'colors.barFilled': barChar,
  'colors.barEmpty': barChar,
  'colors.*': color,
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Walks the defaults, so unknown user keys are dropped and every key is validated.
function normalize(defaults: Record<string, unknown>, input: unknown, prefix = ''): Record<string, unknown> {
  const source = isPlainObject(input) ? input : {};
  const result: Record<string, unknown> = {};
  for (const [key, fallback] of Object.entries(defaults)) {
    const keyPath = prefix + key;
    const rule = RULES[keyPath] ?? RULES[`${prefix}*`];
    const value = source[key];
    if (rule) {
      result[key] = rule(value, fallback);
    } else if (isPlainObject(fallback)) {
      result[key] = normalize(fallback, value, `${keyPath}.`);
    } else {
      result[key] = typeof fallback === 'boolean' && typeof value === 'boolean' ? value : fallback;
    }
  }
  return result;
}

// v0.0.x wrote `layout: "default" | "separators"`; some third-party tools write an object.
function migrateLegacyLayout(config: Record<string, unknown>): Record<string, unknown> {
  if (!('layout' in config) || 'lineLayout' in config) return config;
  const { layout, ...rest } = config;
  if (typeof layout === 'string') {
    return { ...rest, lineLayout: 'compact', showSeparators: layout === 'separators' };
  }
  if (isPlainObject(layout)) {
    const { lineLayout, showSeparators, pathLevels } = layout;
    return {
      ...rest,
      ...(typeof lineLayout === 'string' && { lineLayout }),
      ...(typeof showSeparators === 'boolean' && { showSeparators }),
      ...((typeof pathLevels === 'number' || pathLevels === 'full') && { pathLevels }),
    };
  }
  return rest;
}

export function mergeConfig(userConfig: Partial<HudConfig>): HudConfig {
  const migrated = migrateLegacyLayout(userConfig as Record<string, unknown>);
  const defaults = structuredClone(DEFAULT_CONFIG) as unknown as Record<string, unknown>;
  return normalize(defaults, migrated) as unknown as HudConfig;
}

function hasSafeConfigShape(value: unknown, depth = 0): boolean {
  if (depth > MAX_CONFIG_NESTING_DEPTH) return false;
  if (Array.isArray(value)) return value.every(item => hasSafeConfigShape(item, depth + 1));
  if (!isPlainObject(value)) return true;
  return Object.entries(value).every(([key, child]) => (
    !UNSAFE_CONFIG_KEYS.has(key) && hasSafeConfigShape(child, depth + 1)
  ));
}

// Sections merge key by key; arrays and scalars replace the base value.
function mergeOverrides(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const result = Object.assign(Object.create(null), base) as Record<string, unknown>;
  for (const [key, value] of Object.entries(override)) {
    const current = result[key];
    result[key] = isPlainObject(current) && isPlainObject(value) ? mergeOverrides(current, value) : value;
  }
  return result;
}

// Checks and reads through one descriptor so a swapped or growing file can't slip past either guard.
function readConfigFile(configPath: string): Record<string, unknown> | null {
  try {
    // O_NOFOLLOW rejects symlinks on POSIX; it is undefined on Windows.
    const fd = fs.openSync(configPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    try {
      if (!fs.fstatSync(fd).isFile()) {
        debug('Ignoring %s: not a regular file', configPath);
        return null;
      }
      const buf = Buffer.alloc(MAX_CONFIG_FILE_BYTES + 1);
      let length = 0;
      let bytesRead: number;
      do {
        bytesRead = fs.readSync(fd, buf, length, buf.length - length, length);
        length += bytesRead;
      } while (bytesRead > 0 && length < buf.length);
      if (length > MAX_CONFIG_FILE_BYTES) {
        debug('Ignoring %s: larger than %d bytes', configPath, MAX_CONFIG_FILE_BYTES);
        return null;
      }
      const parsed: unknown = JSON.parse(buf.subarray(0, length).toString('utf-8'));
      if (!isPlainObject(parsed) || !hasSafeConfigShape(parsed)) {
        debug('Ignoring %s: not a bounded JSON object without unsafe keys', configPath);
        return null;
      }
      return parsed;
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      debug('Ignoring %s:', configPath, err instanceof Error ? err.message : err);
    }
    return null;
  }
}

export async function loadConfig(): Promise<HudConfig> {
  const base = readConfigFile(getConfigPath()) ?? {};
  const override = readConfigFile(getConfigOverridePath());
  return mergeConfig((override ? mergeOverrides(base, override) : base) as Partial<HudConfig>);
}
