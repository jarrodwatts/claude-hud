import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'node:crypto';
import { createDebug } from './debug.js';
import { getClaudeConfigDir, getClaudeConfigJsonPath, getHudPluginDir } from './claude-config-dir.js';

const debug = createDebug('config');

export interface ConfigCounts {
  claudeMdCount: number;
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
    path.join(claudeDir, 'CLAUDE.md'),
    path.join(claudeDir, 'rules'),
    path.join(claudeDir, 'settings.json'),
    path.join(claudeDir, 'settings.local.json'),
    claudeConfigJsonPath,
  ];

  if (cwd) {
    paths.push(
      cwd,
      path.join(cwd, '.claude'),
      path.join(cwd, '.claude', 'rules'),
      path.join(cwd, '.mcp.json'),
      path.join(cwd, '.claude', 'settings.json'),
      path.join(cwd, '.claude', 'settings.local.json'),
    );
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

function computeConfigCountsFresh(cwd?: string): ConfigCounts {
  let claudeMdCount = 0;
  let rulesCount = 0;
  let hooksCount = 0;
  let outputStyle: string | undefined;

  const homeDir = os.homedir();
  const claudeDir = getClaudeConfigDir(homeDir);

  // Collect all MCP servers across scopes, then subtract disabled ones
  const userMcpServers = new Set<string>();
  const projectMcpServers = new Set<string>();

  // === USER SCOPE ===

  // ~/.claude/CLAUDE.md
  if (fs.existsSync(path.join(claudeDir, 'CLAUDE.md'))) {
    claudeMdCount++;
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
    // {cwd}/CLAUDE.md
    if (fs.existsSync(path.join(cwd, 'CLAUDE.md'))) {
      claudeMdCount++;
    }

    // {cwd}/CLAUDE.local.md
    if (fs.existsSync(path.join(cwd, 'CLAUDE.local.md'))) {
      claudeMdCount++;
    }

    // {cwd}/.claude/CLAUDE.md (alternative location, skip when it is user scope)
    if (!projectClaudeOverlapsUserScope && fs.existsSync(path.join(cwd, '.claude', 'CLAUDE.md'))) {
      claudeMdCount++;
    }

    // {cwd}/.claude/CLAUDE.local.md
    if (fs.existsSync(path.join(cwd, '.claude', 'CLAUDE.local.md'))) {
      claudeMdCount++;
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

  return { claudeMdCount, rulesCount, mcpCount, hooksCount, outputStyle };
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

  if (cached && sentinelsMatch(cached.key.sentinels, currentSentinels)) {
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
