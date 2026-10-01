import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { expandHomeDirPrefix, getClaudeConfigDir, getHudPluginDir } from './claude-config-dir.js';
import { createDebug } from './debug.js';
import { MAX_TERMINAL_WIDTH } from './utils/terminal.js';
import { sanitizeDisplayText } from './utils/sanitize.js';
const debug = createDebug('config');
const MAX_CONFIG_FILE_BYTES = 64 * 1024;
const MAX_CONFIG_NESTING_DEPTH = 8;
const UNSAFE_CONFIG_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const LANGUAGES = ['en', 'zh', 'zh-Hans', 'zh-Hant', 'zh-TW'];
const LINE_LAYOUTS = ['compact', 'expanded'];
const PATH_LEVELS = [1, 2, 3, 'full'];
const AUTOCOMPACT_BUFFER_MODES = ['enabled', 'disabled'];
const CONTEXT_VALUE_MODES = ['percent', 'tokens', 'remaining', 'both'];
const USAGE_VALUE_MODES = ['percent', 'remaining'];
const GIT_BRANCH_OVERFLOW_MODES = ['truncate', 'wrap'];
// full: display name as-is; compact: drop the context-window suffix; short: also drop "Claude ".
const MODEL_FORMATS = ['full', 'compact', 'short'];
const MODEL_SOURCES = ['auto', 'stdin', 'transcript'];
const EFFORT_FORMATS = ['full', 'symbol', 'text'];
const TIME_FORMATS = ['relative', 'absolute', 'both', 'elapsed', 'elapsedAndAbsolute'];
const HOUR_CYCLES = ['auto', 'h11', 'h12', 'h23', 'h24'];
const CUSTOM_LINE_POSITIONS = ['first', 'last'];
const ADDED_DIRS_LAYOUTS = ['inline', 'line'];
const COLOR_NAMES = ['dim', 'red', 'green', 'yellow', 'magenta', 'cyan', 'brightBlue', 'brightMagenta'];
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
];
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
];
export const DEFAULT_ELEMENT_ORDER = [...ELEMENTS];
export const DEFAULT_MERGE_GROUPS = [['context', 'usage']];
// Empty keeps each renderer's native order until the user moves a segment.
export const DEFAULT_PROJECT_LINE_ORDER = [];
export const DEFAULT_CONFIG = {
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
        promptCacheTtlSeconds: 300,
        showCacheHitRate: false,
        showSessionTokens: false,
        showOutputStyle: false,
        showSessionStartDate: false,
        showLastResponseAt: false,
        showCompactions: false,
        mergeGroups: DEFAULT_MERGE_GROUPS.map(group => [...group]),
        rightAlign: [],
        autocompactBuffer: 'enabled',
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
export function getConfigPath() {
    return path.join(getHudPluginDir(os.homedir()), 'config.json');
}
// Lives outside plugins/, which users often symlink across several CLAUDE_CONFIG_DIRs,
// so it stays per-directory and can override the shared config.
export function getConfigOverridePath() {
    return path.join(getClaudeConfigDir(os.homedir()), 'claude-hud.json');
}
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const oneOf = (allowed) => (value, fallback) => (allowed.includes(value) ? value : fallback);
const clamp = (min, max) => (value, fallback) => (isNumber(value) ? Math.max(min, Math.min(max, value)) : fallback);
const floorAtLeastZero = (value, fallback) => (isNumber(value) ? Math.max(0, Math.floor(value)) : fallback);
const count = (value, fallback) => (Number.isInteger(value) && value >= 0 ? value : fallback);
const text = (maxLength) => (value, fallback) => (typeof value === 'string' ? sanitizeDisplayText(value).slice(0, maxLength) : fallback);
// Keeps known names once each, in order. An empty result falls back only when `nonEmpty`.
const names = (known, nonEmpty) => (value, fallback) => {
    if (!Array.isArray(value))
        return fallback;
    const kept = [...new Set(value.filter(item => known.includes(item)))];
    return kept.length > 0 || !nonEmpty ? kept : fallback;
};
// Groups need two or more known elements, and an element joins at most one group.
const mergeGroups = (value, fallback) => {
    if (!Array.isArray(value))
        return fallback;
    if (value.length === 0)
        return [];
    const used = new Set();
    const groups = [];
    for (const group of value) {
        if (!Array.isArray(group))
            continue;
        const members = [...new Set(group.filter(item => ELEMENTS.includes(item) && !used.has(item)))];
        if (members.length < 2)
            continue;
        members.forEach(member => used.add(member));
        groups.push(members);
    }
    return groups.length > 0 ? groups : fallback;
};
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const color = (value, fallback) => (COLOR_NAMES.includes(value)
    || (Number.isInteger(value) && value >= 0 && value <= 255)
    || (typeof value === 'string' && HEX_COLOR.test(value))
    ? value
    : fallback);
// Exactly one visible grapheme: no controls, format, variation, separator, or unassigned code points.
const INVISIBLE_CODEPOINT = /[\p{Cc}\p{Cf}\p{Variation_Selector}\p{Zl}\p{Zp}\p{Cn}]/u;
const barChar = (value, fallback) => {
    if (typeof value !== 'string' || value.length === 0)
        return fallback;
    const graphemes = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)];
    return graphemes.length === 1 && !INVISIBLE_CODEPOINT.test(value) ? value : fallback;
};
// Expands a leading ~ and ${VAR}; unset variables are left as written.
const usagePath = (value) => (typeof value === 'string'
    ? expandHomeDirPrefix(value.trim(), os.homedir())
        .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name) => process.env[name] ?? match)
    : '');
// Booleans need no rule: a default of type boolean accepts only booleans.
const RULES = {
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
    'display.promptCacheTtlSeconds': (value, fallback) => (isNumber(value) && value > 0 ? Math.floor(value) : fallback),
    'display.mergeGroups': mergeGroups,
    'display.rightAlign': names(ELEMENTS, false),
    'display.autocompactBuffer': oneOf(AUTOCOMPACT_BUFFER_MODES),
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
    'display.autoCompactWindow': (value) => (Number.isInteger(value) && value > 0 ? value : null),
    'colors.barFilled': barChar,
    'colors.barEmpty': barChar,
    'colors.*': color,
};
function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
// Walks the defaults, so unknown user keys are dropped and every key is validated.
function normalize(defaults, input, prefix = '') {
    const source = isPlainObject(input) ? input : {};
    const result = {};
    for (const [key, fallback] of Object.entries(defaults)) {
        const keyPath = prefix + key;
        const rule = RULES[keyPath] ?? RULES[`${prefix}*`];
        const value = source[key];
        if (rule) {
            result[key] = rule(value, fallback);
        }
        else if (isPlainObject(fallback)) {
            result[key] = normalize(fallback, value, `${keyPath}.`);
        }
        else {
            result[key] = typeof fallback === 'boolean' && typeof value === 'boolean' ? value : fallback;
        }
    }
    return result;
}
// v0.0.x wrote `layout: "default" | "separators"`; some third-party tools write an object.
function migrateLegacyLayout(config) {
    if (!('layout' in config) || 'lineLayout' in config)
        return config;
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
export function mergeConfig(userConfig) {
    const migrated = migrateLegacyLayout(userConfig);
    const defaults = structuredClone(DEFAULT_CONFIG);
    return normalize(defaults, migrated);
}
function hasSafeConfigShape(value, depth = 0) {
    if (depth > MAX_CONFIG_NESTING_DEPTH)
        return false;
    if (Array.isArray(value))
        return value.every(item => hasSafeConfigShape(item, depth + 1));
    if (!isPlainObject(value))
        return true;
    return Object.entries(value).every(([key, child]) => (!UNSAFE_CONFIG_KEYS.has(key) && hasSafeConfigShape(child, depth + 1)));
}
// Sections merge key by key; arrays and scalars replace the base value.
function mergeOverrides(base, override) {
    const result = Object.assign(Object.create(null), base);
    for (const [key, value] of Object.entries(override)) {
        const current = result[key];
        result[key] = isPlainObject(current) && isPlainObject(value) ? mergeOverrides(current, value) : value;
    }
    return result;
}
// Checks and reads through one descriptor so a swapped or growing file can't slip past either guard.
function readConfigFile(configPath) {
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
            let bytesRead;
            do {
                bytesRead = fs.readSync(fd, buf, length, buf.length - length, length);
                length += bytesRead;
            } while (bytesRead > 0 && length < buf.length);
            if (length > MAX_CONFIG_FILE_BYTES) {
                debug('Ignoring %s: larger than %d bytes', configPath, MAX_CONFIG_FILE_BYTES);
                return null;
            }
            const parsed = JSON.parse(buf.subarray(0, length).toString('utf-8'));
            if (!isPlainObject(parsed) || !hasSafeConfigShape(parsed)) {
                debug('Ignoring %s: not a bounded JSON object without unsafe keys', configPath);
                return null;
            }
            return parsed;
        }
        finally {
            fs.closeSync(fd);
        }
    }
    catch (err) {
        if (err.code !== 'ENOENT') {
            debug('Ignoring %s:', configPath, err instanceof Error ? err.message : err);
        }
        return null;
    }
}
export async function loadConfig() {
    const base = readConfigFile(getConfigPath()) ?? {};
    const override = readConfigFile(getConfigOverridePath());
    return mergeConfig((override ? mergeOverrides(base, override) : base));
}
//# sourceMappingURL=config.js.map