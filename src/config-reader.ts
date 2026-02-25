import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createDebug } from './debug.js';

const debug = createDebug('config');

const CONFIG_CACHE_TTL_MS = 10_000; // 10 seconds — configs change rarely

export interface ConfigCounts {
  claudeMdCount: number;
  rulesCount: number;
  mcpCount: number;
  hooksCount: number;
}

interface ConfigCountsCache {
  counts: ConfigCounts;
  timestamp: number;
  cwdKey: string;
  settingsMtime?: number;
}

export type ConfigReaderDeps = {
  homeDir: () => string;
  now: () => number;
};

const defaultDeps: ConfigReaderDeps = {
  homeDir: () => os.homedir(),
  now: () => Date.now(),
};

function getConfigCachePath(homeDir: string): string {
  return path.join(homeDir, '.claude', 'plugins', 'claude-hud', '.config-cache.json');
}

function getSettingsMtime(homeDir: string, cwd?: string): number {
  let maxMtime = 0;
  const paths = [
    path.join(homeDir, '.claude', 'settings.json'),
    path.join(homeDir, '.claude.json'),
  ];
  if (cwd) {
    paths.push(
      path.join(cwd, '.claude', 'settings.json'),
      path.join(cwd, '.claude', 'settings.local.json'),
      path.join(cwd, '.mcp.json'),
    );
  }
  for (const p of paths) {
    try {
      const stat = fs.statSync(p);
      if (stat.mtimeMs > maxMtime) maxMtime = stat.mtimeMs;
    } catch {
      // File doesn't exist
    }
  }
  return maxMtime;
}

function readConfigCache(homeDir: string, now: number, cwd?: string): ConfigCounts | null {
  try {
    const cachePath = getConfigCachePath(homeDir);
    if (!fs.existsSync(cachePath)) return null;
    const content = fs.readFileSync(cachePath, 'utf8');
    const cache: ConfigCountsCache = JSON.parse(content);
    if (now - cache.timestamp >= CONFIG_CACHE_TTL_MS) return null;
    if (cache.cwdKey !== (cwd ?? '')) return null;
    // Invalidate cache if settings files have been modified
    const currentMtime = getSettingsMtime(homeDir, cwd);
    if (cache.settingsMtime !== undefined && currentMtime > cache.settingsMtime) return null;
    return cache.counts;
  } catch {
    return null;
  }
}

function writeConfigCache(homeDir: string, counts: ConfigCounts, now: number, cwd?: string): void {
  try {
    const cachePath = getConfigCachePath(homeDir);
    const cacheDir = path.dirname(cachePath);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    const settingsMtime = getSettingsMtime(homeDir, cwd);
    const cache: ConfigCountsCache = { counts, timestamp: now, cwdKey: cwd ?? '', settingsMtime };
    fs.writeFileSync(cachePath, JSON.stringify(cache), 'utf8');
  } catch {
    // Ignore cache write failures
  }
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

export async function countConfigs(
  cwd?: string,
  overrides: Partial<ConfigReaderDeps> = {},
): Promise<ConfigCounts> {
  const deps = { ...defaultDeps, ...overrides };
  const homeDir = deps.homeDir();
  const now = deps.now();

  // Check cache first
  const cached = readConfigCache(homeDir, now, cwd);
  if (cached) {
    return cached;
  }

  let claudeMdCount = 0;
  let rulesCount = 0;
  let hooksCount = 0;

  const claudeDir = path.join(homeDir, '.claude');

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

  // ~/.claude.json (additional user-scope MCPs)
  const userClaudeJson = path.join(homeDir, '.claude.json');
  for (const name of getMcpServerNames(userClaudeJson)) {
    userMcpServers.add(name);
  }

  // Get disabled user-scope MCPs from ~/.claude.json
  const disabledUserMcps = getDisabledMcpServers(userClaudeJson, 'disabledMcpServers');
  for (const name of disabledUserMcps) {
    userMcpServers.delete(name);
  }

  // === PROJECT SCOPE ===

  if (cwd) {
    // {cwd}/CLAUDE.md
    if (fs.existsSync(path.join(cwd, 'CLAUDE.md'))) {
      claudeMdCount++;
    }

    // {cwd}/CLAUDE.local.md
    if (fs.existsSync(path.join(cwd, 'CLAUDE.local.md'))) {
      claudeMdCount++;
    }

    // {cwd}/.claude/CLAUDE.md (alternative location)
    if (fs.existsSync(path.join(cwd, '.claude', 'CLAUDE.md'))) {
      claudeMdCount++;
    }

    // {cwd}/.claude/CLAUDE.local.md
    if (fs.existsSync(path.join(cwd, '.claude', 'CLAUDE.local.md'))) {
      claudeMdCount++;
    }

    // {cwd}/.claude/rules/*.md (recursive)
    rulesCount += countRulesInDir(path.join(cwd, '.claude', 'rules'));

    // {cwd}/.mcp.json (project MCP config) - tracked separately for disabled filtering
    const mcpJsonServers = getMcpServerNames(path.join(cwd, '.mcp.json'));

    // {cwd}/.claude/settings.json (project settings)
    const projectSettings = path.join(cwd, '.claude', 'settings.json');
    for (const name of getMcpServerNames(projectSettings)) {
      projectMcpServers.add(name);
    }
    hooksCount += countHooksInFile(projectSettings);

    // {cwd}/.claude/settings.local.json (local project settings)
    const localSettings = path.join(cwd, '.claude', 'settings.local.json');
    for (const name of getMcpServerNames(localSettings)) {
      projectMcpServers.add(name);
    }
    hooksCount += countHooksInFile(localSettings);

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

  const counts = { claudeMdCount, rulesCount, mcpCount, hooksCount };
  writeConfigCache(homeDir, counts, now, cwd);
  return counts;
}

