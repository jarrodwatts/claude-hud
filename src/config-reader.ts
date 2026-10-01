import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createDebug } from './debug.js';
import { getClaudeConfigDir, getClaudeConfigJsonPath } from './claude-config-dir.js';

const debug = createDebug('config-reader');

const MAX_RULE_ENTRIES = 10_000;
const MAX_RULE_DIRECTORIES = 1_000;

export interface ConfigCounts {
  claudeMdCount: number;
  rulesCount: number;
  mcpCount: number;
  hooksCount: number;
}

function readJson(filePath: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      debug(`Failed to read ${filePath}:`, error);
    }
    return null;
  }
}

const keysOf = (value: unknown): string[] =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : [];

const stringsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

function realPath(inputPath: string): string | null {
  try {
    return fs.realpathSync.native(inputPath);
  } catch {
    return null;
  }
}

// Counts .md files recursively, following symlinks once each and bounded so a
// symlink loop or a huge tree can't stall the statusline.
function countRules(dir: string, state = { visited: new Set<string>(), entries: 0, directories: 0 }): number {
  const root = realPath(dir);
  if (!root || state.visited.has(root) || state.directories >= MAX_RULE_DIRECTORIES) return 0;
  state.visited.add(root);
  state.directories += 1;

  let count = 0;
  try {
    for (const entry of fs.readdirSync(root)) {
      if (++state.entries > MAX_RULE_ENTRIES) break;
      const target = realPath(path.join(root, entry));
      if (!target || state.visited.has(target)) continue;
      const stat = fs.statSync(target);
      if (stat.isDirectory()) {
        count += countRules(target, state);
      } else if (stat.isFile() && entry.endsWith('.md')) {
        state.visited.add(target);
        count += 1;
      }
    }
  } catch (error) {
    debug(`Failed to read rules from ${dir}:`, error);
  }
  return count;
}

function sameLocation(a: string, b: string): boolean {
  const normalize = (p: string): string => {
    const resolved = path.resolve(p).replace(/[\\/]+$/, '') || path.parse(path.resolve(p)).root;
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  if (normalize(a) === normalize(b)) return true;
  const realA = realPath(a);
  const realB = realPath(b);
  return realA !== null && realB !== null && normalize(realA) === normalize(realB);
}

export function countConfigs(cwd?: string): ConfigCounts {
  const homeDir = os.homedir();
  const claudeDir = getClaudeConfigDir(homeDir);
  const exists = (...parts: string[]): boolean => fs.existsSync(path.join(...parts));

  const userSettings = readJson(path.join(claudeDir, 'settings.json'));
  const claudeJson = readJson(getClaudeConfigJsonPath(homeDir));
  const userMcp = new Set([...keysOf(userSettings?.mcpServers), ...keysOf(claudeJson?.mcpServers)]);
  for (const name of stringsOf(claudeJson?.disabledMcpServers)) userMcp.delete(name);

  let claudeMdCount = exists(claudeDir, 'CLAUDE.md') ? 1 : 0;
  let rulesCount = countRules(path.join(claudeDir, 'rules'));
  let hooksCount = keysOf(userSettings?.hooks).length;
  const projectMcp = new Set<string>();

  if (cwd) {
    const projectDir = path.join(cwd, '.claude');
    // When the project's .claude is the user config dir, its files were counted above.
    const isUserDir = sameLocation(projectDir, claudeDir);
    claudeMdCount += [
      exists(cwd, 'CLAUDE.md'),
      exists(cwd, 'CLAUDE.local.md'),
      !isUserDir && exists(projectDir, 'CLAUDE.md'),
      exists(projectDir, 'CLAUDE.local.md'),
    ].filter(Boolean).length;

    if (!isUserDir) {
      rulesCount += countRules(path.join(projectDir, 'rules'));
      const projectSettings = readJson(path.join(projectDir, 'settings.json'));
      for (const name of keysOf(projectSettings?.mcpServers)) projectMcp.add(name);
      hooksCount += keysOf(projectSettings?.hooks).length;
    }

    const localSettings = readJson(path.join(projectDir, 'settings.local.json'));
    for (const name of keysOf(localSettings?.mcpServers)) projectMcp.add(name);
    hooksCount += keysOf(localSettings?.hooks).length;

    const disabledMcpJson = new Set(stringsOf(localSettings?.disabledMcpjsonServers));
    for (const name of keysOf(readJson(path.join(cwd, '.mcp.json'))?.mcpServers)) {
      if (!disabledMcpJson.has(name)) projectMcp.add(name);
    }
  }

  // A server named in both scopes counts twice: they are separate configs.
  return { claudeMdCount, rulesCount, mcpCount: userMcp.size + projectMcp.size, hooksCount };
}
