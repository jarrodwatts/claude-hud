import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'node:crypto';
import { createDebug } from './debug.js';
import { getClaudeConfigDir, getClaudeConfigJsonPath, getHudPluginDir } from './claude-config-dir.js';

const debug = createDebug('config');

export interface ConfigCounts {
  claudeMdCount: number;
  /** Abbreviated paths of each detected CLAUDE.md file (home -> ~, project -> ./). */
  claudeMdPaths: string[];
  rulesCount: number;
  mcpCount: number;
  hooksCount: number;
  outputStyle?: string;
}

interface SentinelState {
  mtimeMs: number;
  size: number;
}

interface ConfigCacheKey {
  cwd: string | null;
  claudeConfigDir: string;
  sentinels: Record<string, SentinelState | null>;
}

interface ConfigCacheFile {
  key: ConfigCacheKey;
  data: ConfigCounts;
}

// Valid keys for disabled MCP arrays in config files
type DisabledMcpKey = 'disabledMcpServers' | 'disabledMcpjsonServers';

function getMcpServerNames(filePath: string): Set<string> {
  if (!fs.existsSync(filePath)) return new Set();
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const config = JSON.parse(content);
    if (config.mcpServers && typeof config.mcpServers === 'object') {
      return new Set(Object.keys(config.mcpServers));
    }
  } catch (error) {
    debug(`Failed to read MCP servers from ${filePath}:`, error);
  }
  return new Set();
}

function getDisabledMcpServers(filePath: string, key: DisabledMcpKey): Set<string> {
  if (!fs.existsSync(filePath)) return new Set();
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const config = JSON.parse(content);
    if (Array.isArray(config[key])) {
      const validNames = config[key].filter((s: unknown) => typeof s === 'string');
      if (validNames.length !== config[key].length) {
        debug(`${key} in ${filePath} contains non-string values, ignoring them`);
      }
      return new Set(validNames);
    }
  } catch (error) {
    debug(`Failed to read ${key} from ${filePath}:`, error);
  }
  return new Set();
}

function countMcpServersInFile(filePath: string, excludeFrom?: string): number {
  const servers = getMcpServerNames(filePath);
  if (excludeFrom) {
    const exclude = getMcpServerNames(excludeFrom);
    for (const name of exclude) {
      servers.delete(name);
    }
  }
  return servers.size;
}

function countHooksInFile(filePath: string): number {
  if (!fs.existsSync(filePath)) return 0;
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const config = JSON.parse(content);
    if (config.hooks && typeof config.hooks === 'object') {
      return Object.keys(config.hooks).length;
    }
  } catch (error) {
    debug(`Failed to read hooks from ${filePath}:`, error);
  }
  return 0;
}

function readStringSetting(filePath: string, key: string): string | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const config = JSON.parse(content);
    if (typeof config[key] === 'string') {
      const value = config[key].trim();
      return value.length > 0 ? value : undefined;
    }
  } catch (error) {
    debug(`Failed to read ${key} from ${filePath}:`, error);
  }
  return undefined;
}

/** Read a string[] setting from a JSON settings file (non-strings dropped). */
function readArraySetting(filePath: string, key: string): string[] {
  if (!fs.existsSync(filePath)) return [];
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const config = JSON.parse(content);
    if (Array.isArray(config[key])) {
      return config[key].filter((v: unknown): v is string => typeof v === 'string');
    }
  } catch (error) {
    debug(`Failed to read ${key} from ${filePath}:`, error);
  }
  return [];
}

/**
 * Convert a claudeMdExcludes glob (e.g. `**\/monorepo/CLAUDE.md`) to an anchored
 * RegExp. `**` matches across path separators, `*` within a segment, `?` one
 * char. Paths are matched with `/` separators (callers normalize first).
 */
function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, '/');
  let re = '';
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i];
    if (c === '*') {
      if (normalized[i + 1] === '*') {
        re += '.*';
        i++;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

/** True if absPath matches any claudeMdExcludes glob pattern. */
function matchesAnyGlob(absPath: string, patterns: RegExp[]): boolean {
  const normalized = path.resolve(absPath).replace(/\\/g, '/');
  return patterns.some((re) => re.test(normalized));
}

function countRulesInDir(rulesDir: string): number {
  if (!fs.existsSync(rulesDir)) return 0;
  let count = 0;
  try {
    const entries = fs.readdirSync(rulesDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(rulesDir, entry.name);
      if (entry.isDirectory()) {
        count += countRulesInDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        count++;
      }
    }
  } catch (error) {
    debug(`Failed to read rules from ${rulesDir}:`, error);
  }
  return count;
}

function normalizePathForComparison(inputPath: string): string {
  let normalized = path.normalize(path.resolve(inputPath));
  const root = path.parse(normalized).root;
  while (normalized.length > root.length && normalized.endsWith(path.sep)) {
    normalized = normalized.slice(0, -1);
  }
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function pathsReferToSameLocation(pathA: string, pathB: string): boolean {
  if (normalizePathForComparison(pathA) === normalizePathForComparison(pathB)) {
    return true;
  }

  if (!fs.existsSync(pathA) || !fs.existsSync(pathB)) {
    return false;
  }

  try {
    const realPathA = fs.realpathSync.native(pathA);
    const realPathB = fs.realpathSync.native(pathB);
    return normalizePathForComparison(realPathA) === normalizePathForComparison(realPathB);
  } catch {
    return false;
  }
}

function getConfigCachePath(cwd: string | null, claudeConfigDir: string, homeDir: string): string {
  const identity = JSON.stringify({ cwd, claudeConfigDir });
  const hash = createHash('sha256').update(identity).digest('hex');
  return path.join(getHudPluginDir(homeDir), 'config-cache', `${hash}.json`);
}

function statSentinel(filePath: string): SentinelState | null {
  try {
    const stat = fs.statSync(filePath);
    return { mtimeMs: stat.mtimeMs, size: stat.size };
  } catch {
    return null;
  }
}

function buildSentinelPaths(claudeDir: string, claudeConfigJsonPath: string, cwd: string | null): string[] {
  // Note: We sentinel CLAUDE.md directly instead of claudeDir because the
  // cache itself is stored under claudeDir/plugins/, which would change
  // claudeDir's mtime and immediately invalidate the cache on every write.
  const paths = [
    getManagedPolicyClaudeMdPath(),
    path.join(claudeDir, 'CLAUDE.md'),
    path.join(claudeDir, 'rules'),
    path.join(claudeDir, 'settings.json'),
    path.join(claudeDir, 'settings.local.json'),
    claudeConfigJsonPath,
  ];

  if (cwd) {
    paths.push(
      path.join(cwd, '.claude'),
      path.join(cwd, '.claude', 'rules'),
      path.join(cwd, '.mcp.json'),
      path.join(cwd, '.claude', 'settings.json'),
      path.join(cwd, '.claude', 'settings.local.json'),
    );
    // Sentinel every ancestor directory (root -> cwd, includes cwd). A
    // directory's mtime changes when a CLAUDE.md is added/removed inside it,
    // so this invalidates the cache when memory files appear/disappear anywhere
    // up the tree.
    for (const dir of ancestorDirsFromRoot(cwd)) {
      paths.push(dir);
    }
  }

  return paths;
}

function collectRuleDirectorySentinels(rulesDir: string): string[] {
  if (!fs.existsSync(rulesDir)) return [];

  const sentinels = [rulesDir];
  try {
    const entries = fs.readdirSync(rulesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      sentinels.push(...collectRuleDirectorySentinels(path.join(rulesDir, entry.name)));
    }
  } catch (error) {
    debug(`Failed to read rule sentinel paths from ${rulesDir}:`, error);
  }

  return sentinels;
}

function statSentinels(paths: string[]): Record<string, SentinelState | null> {
  const result: Record<string, SentinelState | null> = {};
  for (const p of paths) {
    result[p] = statSentinel(p);
  }
  return result;
}

function sentinelsMatch(a: Record<string, SentinelState | null>, b: Record<string, SentinelState | null>): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    const sa = a[key];
    const sb = b[key];
    if (sa === null && sb === null) continue;
    if (sa === null || sb === null) return false;
    if (sa.mtimeMs !== sb.mtimeMs || sa.size !== sb.size) return false;
  }
  return true;
}

function isConfigCounts(value: unknown): value is ConfigCounts {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const counts = value as Partial<ConfigCounts>;
  return (
    typeof counts.claudeMdCount === 'number'
    && Number.isFinite(counts.claudeMdCount)
    && counts.claudeMdCount >= 0
    && typeof counts.rulesCount === 'number'
    && Number.isFinite(counts.rulesCount)
    && counts.rulesCount >= 0
    && typeof counts.mcpCount === 'number'
    && Number.isFinite(counts.mcpCount)
    && counts.mcpCount >= 0
    && typeof counts.hooksCount === 'number'
    && Number.isFinite(counts.hooksCount)
    && counts.hooksCount >= 0
    && (counts.outputStyle === undefined || typeof counts.outputStyle === 'string')
  );
}

function readConfigCache(cacheKey: Pick<ConfigCacheKey, 'cwd' | 'claudeConfigDir'>, homeDir: string): ConfigCacheFile | null {
  try {
    const cachePath = getConfigCachePath(cacheKey.cwd, cacheKey.claudeConfigDir, homeDir);
    const raw = fs.readFileSync(cachePath, 'utf8');
    const parsed = JSON.parse(raw) as ConfigCacheFile;
    if (parsed.key?.cwd !== cacheKey.cwd || parsed.key?.claudeConfigDir !== cacheKey.claudeConfigDir) {
      return null;
    }
    if (!isConfigCounts(parsed.data)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeConfigCache(key: ConfigCacheKey, data: ConfigCounts, homeDir: string): void {
  try {
    const cachePath = getConfigCachePath(key.cwd, key.claudeConfigDir, homeDir);
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    const payload: ConfigCacheFile = { key, data };
    fs.writeFileSync(cachePath, JSON.stringify(payload), 'utf8');
  } catch {
    // Cache write failures are non-fatal.
  }
}

/**
 * Render an absolute path in a compact, readable form for the statusline.
 * Project files (inside cwd) become `./...`; files under the home directory
 * become `~/...`; anything else is left absolute. cwd is checked first because
 * a project usually lives under the home directory.
 */
function abbreviateConfigPath(absPath: string, homeDir: string, cwd?: string): string {
  const toPosix = (p: string) => p.split(path.sep).join('/');
  const isInside = (rel: string) => rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);

  if (cwd) {
    const relFromCwd = path.relative(cwd, absPath);
    if (isInside(relFromCwd)) {
      return `./${toPosix(relFromCwd)}`;
    }
  }

  const relFromHome = path.relative(homeDir, absPath);
  if (isInside(relFromHome)) {
    return `~/${toPosix(relFromHome)}`;
  }

  return absPath;
}

/**
 * OS-specific managed-policy (enterprise) CLAUDE.md location that Claude Code
 * loads first. Mirrors the documented paths in code.claude.com/docs/memory.
 */
function getManagedPolicyClaudeMdPath(): string {
  switch (process.platform) {
    case 'darwin':
      return '/Library/Application Support/ClaudeCode/CLAUDE.md';
    case 'win32':
      return path.join(process.env.ProgramFiles || 'C:\\Program Files', 'ClaudeCode', 'CLAUDE.md');
    default:
      // Linux / WSL
      return '/etc/claude-code/CLAUDE.md';
  }
}

/**
 * Directories from the filesystem root down to (and including) cwd, ordered
 * root -> cwd. Claude Code loads CLAUDE.md/CLAUDE.local.md from every directory
 * along this path, so we walk the same tree rather than only inspecting cwd.
 */
function ancestorDirsFromRoot(cwd: string): string[] {
  const dirs: string[] = [];
  let dir = path.resolve(cwd);
  while (true) {
    dirs.push(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached the filesystem root
    dir = parent;
  }
  return dirs.reverse();
}

function computeConfigCountsFresh(cwd?: string): ConfigCounts {
  const claudeMdPaths: string[] = [];
  let rulesCount = 0;
  let hooksCount = 0;
  let outputStyle: string | undefined;

  const homeDir = os.homedir();
  const claudeDir = getClaudeConfigDir(homeDir);

  // claudeMdExcludes lets users skip specific CLAUDE.md files (glob patterns,
  // merged across settings layers). Gather them up front so every scope below
  // can be filtered. Managed-policy CLAUDE.md is exempt (cannot be excluded).
  const excludePatterns = [
    ...readArraySetting(path.join(claudeDir, 'settings.json'), 'claudeMdExcludes'),
    ...readArraySetting(path.join(claudeDir, 'settings.local.json'), 'claudeMdExcludes'),
    ...(cwd ? readArraySetting(path.join(cwd, '.claude', 'settings.json'), 'claudeMdExcludes') : []),
    ...(cwd ? readArraySetting(path.join(cwd, '.claude', 'settings.local.json'), 'claudeMdExcludes') : []),
  ].map(globToRegExp);

  // Dedupe by resolved absolute path so overlapping scopes (e.g. cwd under the
  // user .claude dir, or an ancestor that is also the user scope) count once.
  const seenClaudeMd = new Set<string>();
  const recordClaudeMd = (absPath: string, managed = false) => {
    if (!managed && matchesAnyGlob(absPath, excludePatterns)) {
      return;
    }
    const resolved = path.resolve(absPath);
    if (seenClaudeMd.has(resolved)) {
      return;
    }
    seenClaudeMd.add(resolved);
    claudeMdPaths.push(abbreviateConfigPath(absPath, homeDir, cwd));
  };

  // Collect all MCP servers across scopes, then subtract disabled ones
  const userMcpServers = new Set<string>();
  const projectMcpServers = new Set<string>();

  // === MANAGED POLICY (enterprise) SCOPE ===
  // Loaded first by Claude Code, ahead of user scope.
  const managedPolicyClaudeMd = getManagedPolicyClaudeMdPath();
  if (fs.existsSync(managedPolicyClaudeMd)) {
    recordClaudeMd(managedPolicyClaudeMd, true);
  }

  // === USER SCOPE ===

  // ~/.claude/CLAUDE.md
  const userClaudeMd = path.join(claudeDir, 'CLAUDE.md');
  if (fs.existsSync(userClaudeMd)) {
    recordClaudeMd(userClaudeMd);
  }

  // ~/.claude/rules/*.md
  rulesCount += countRulesInDir(path.join(claudeDir, 'rules'));

  // ~/.claude/settings.json (MCPs and hooks)
  const userSettings = path.join(claudeDir, 'settings.json');
  for (const name of getMcpServerNames(userSettings)) {
    userMcpServers.add(name);
  }
  hooksCount += countHooksInFile(userSettings);
  outputStyle = readStringSetting(userSettings, 'outputStyle');

  const userLocalSettings = path.join(claudeDir, 'settings.local.json');
  outputStyle = readStringSetting(userLocalSettings, 'outputStyle') ?? outputStyle;

  // {CLAUDE_CONFIG_DIR}.json (additional user-scope MCPs)
  const userClaudeJson = getClaudeConfigJsonPath(homeDir);
  for (const name of getMcpServerNames(userClaudeJson)) {
    userMcpServers.add(name);
  }

  // Get disabled user-scope MCPs from ~/.claude.json
  const disabledUserMcps = getDisabledMcpServers(userClaudeJson, 'disabledMcpServers');
  for (const name of disabledUserMcps) {
    userMcpServers.delete(name);
  }

  // === PROJECT SCOPE ===

  // Avoid double-counting when project .claude directory is the same location as user scope.
  const projectClaudeDir = cwd ? path.join(cwd, '.claude') : null;
  const projectClaudeOverlapsUserScope = projectClaudeDir
    ? pathsReferToSameLocation(projectClaudeDir, claudeDir)
    : false;

  if (cwd) {
    // Walk every directory from the filesystem root down to cwd, matching
    // Claude Code's memory discovery. At each level, CLAUDE.md then
    // CLAUDE.local.md (e.g. a monorepo root's CLAUDE.md above the cwd).
    for (const dir of ancestorDirsFromRoot(cwd)) {
      const ancestorClaudeMd = path.join(dir, 'CLAUDE.md');
      if (fs.existsSync(ancestorClaudeMd)) {
        recordClaudeMd(ancestorClaudeMd);
      }

      const ancestorClaudeLocalMd = path.join(dir, 'CLAUDE.local.md');
      if (fs.existsSync(ancestorClaudeLocalMd)) {
        recordClaudeMd(ancestorClaudeLocalMd);
      }
    }

    // {cwd}/.claude/CLAUDE.md (alternative location, skip when it is user scope)
    const projectDotClaudeMd = path.join(cwd, '.claude', 'CLAUDE.md');
    if (!projectClaudeOverlapsUserScope && fs.existsSync(projectDotClaudeMd)) {
      recordClaudeMd(projectDotClaudeMd);
    }

    // {cwd}/.claude/CLAUDE.local.md
    const projectDotClaudeLocalMd = path.join(cwd, '.claude', 'CLAUDE.local.md');
    if (fs.existsSync(projectDotClaudeLocalMd)) {
      recordClaudeMd(projectDotClaudeLocalMd);
    }

    // {cwd}/.claude/rules/*.md (recursive)
    // Skip when it overlaps with user-scope rules.
    if (!projectClaudeOverlapsUserScope) {
      rulesCount += countRulesInDir(path.join(cwd, '.claude', 'rules'));
    }

    // {cwd}/.mcp.json (project MCP config) - tracked separately for disabled filtering
    const mcpJsonServers = getMcpServerNames(path.join(cwd, '.mcp.json'));

    // {cwd}/.claude/settings.json (project settings)
    // Skip when it overlaps with user-scope settings.
    const projectSettings = path.join(cwd, '.claude', 'settings.json');
    if (!projectClaudeOverlapsUserScope) {
      for (const name of getMcpServerNames(projectSettings)) {
        projectMcpServers.add(name);
      }
      hooksCount += countHooksInFile(projectSettings);
      outputStyle = readStringSetting(projectSettings, 'outputStyle') ?? outputStyle;
    }

    // {cwd}/.claude/settings.local.json (local project settings)
    const localSettings = path.join(cwd, '.claude', 'settings.local.json');
    for (const name of getMcpServerNames(localSettings)) {
      projectMcpServers.add(name);
    }
    hooksCount += countHooksInFile(localSettings);
    outputStyle = readStringSetting(localSettings, 'outputStyle') ?? outputStyle;

    // Get disabled .mcp.json servers from settings.local.json
    const disabledMcpJsonServers = getDisabledMcpServers(localSettings, 'disabledMcpjsonServers');
    for (const name of disabledMcpJsonServers) {
      mcpJsonServers.delete(name);
    }

    // Add remaining .mcp.json servers to project set
    for (const name of mcpJsonServers) {
      projectMcpServers.add(name);
    }
  }

  // Total MCP count = user servers + project servers
  // Note: Deduplication only occurs within each scope, not across scopes.
  // A server with the same name in both user and project scope counts as 2 (separate configs).
  const mcpCount = userMcpServers.size + projectMcpServers.size;

  return { claudeMdCount: claudeMdPaths.length, claudeMdPaths, rulesCount, mcpCount, hooksCount, outputStyle };
}

export async function countConfigs(cwd?: string): Promise<ConfigCounts> {
  const homeDir = os.homedir();
  const claudeDir = getClaudeConfigDir(homeDir);
  const claudeConfigJsonPath = getClaudeConfigJsonPath(homeDir);
  const normalizedCwd = cwd ? path.resolve(cwd) : null;

  const staticSentinelPaths = buildSentinelPaths(claudeDir, claudeConfigJsonPath, normalizedCwd);
  const cached = readConfigCache({ cwd: normalizedCwd, claudeConfigDir: claudeDir }, homeDir);
  const cacheValidationPaths = cached
    ? Array.from(new Set([...staticSentinelPaths, ...Object.keys(cached.key.sentinels)]))
    : staticSentinelPaths;
  const currentSentinels = statSentinels(cacheValidationPaths);

  // Array.isArray guard: a cache entry written before claudeMdPaths existed
  // would lack the field; treat it as a miss so we recompute rather than
  // returning undefined paths downstream.
  if (
    cached &&
    Array.isArray(cached.data.claudeMdPaths) &&
    sentinelsMatch(cached.key.sentinels, currentSentinels)
  ) {
    return cached.data;
  }

  const result = computeConfigCountsFresh(cwd);

  const ruleSentinelPaths = collectRuleDirectorySentinels(path.join(claudeDir, 'rules'));
  const projectClaudeDir = normalizedCwd ? path.join(normalizedCwd, '.claude') : null;
  const projectClaudeOverlapsUserScope = projectClaudeDir
    ? pathsReferToSameLocation(projectClaudeDir, claudeDir)
    : false;
  if (normalizedCwd && !projectClaudeOverlapsUserScope) {
    ruleSentinelPaths.push(...collectRuleDirectorySentinels(path.join(normalizedCwd, '.claude', 'rules')));
  }

  const cacheSentinelPaths = Array.from(new Set([...staticSentinelPaths, ...ruleSentinelPaths]));
  const cacheKey: ConfigCacheKey = {
    cwd: normalizedCwd,
    claudeConfigDir: claudeDir,
    sentinels: statSentinels(cacheSentinelPaths),
  };
  writeConfigCache(cacheKey, result, homeDir);
  return result;
}
