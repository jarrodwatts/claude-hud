import * as fs from 'node:fs';
import * as path from 'node:path';
import { createDebug } from './debug.ts';
import type { Paths } from './channel.ts';

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

  let entries: string[];
  try {
    entries = fs.readdirSync(root);
  } catch (error) {
    debug(`Failed to read rules from ${dir}:`, error);
    return 0;
  }
  let count = 0;
  for (const entry of entries) {
    if (++state.entries > MAX_RULE_ENTRIES) break;
    const target = realPath(path.join(root, entry));
    if (!target || state.visited.has(target)) continue;
    // A link out of the read grants can't be stat'ed; skip it, not the entries after it.
    let stat: fs.Stats;
    try {
      stat = fs.statSync(target);
    } catch (error) {
      debug(`Failed to read rule ${target}:`, error);
      continue;
    }
    if (stat.isDirectory()) {
      count += countRules(target, state);
    } else if (stat.isFile() && entry.endsWith('.md')) {
      state.visited.add(target);
      count += 1;
    }
  }
  return count;
}

/** Counts what the user and project configure. Each file comes from `paths`, so a missing one counts 0. */
export function countConfigs(paths: Pick<Paths, 'user' | 'project' | 'claudeJson'>): ConfigCounts {
  const exists = (file: string | null): boolean => file !== null && fs.existsSync(file);
  const { user, project } = paths;

  const userSettings = readJson(user.settings);
  const claudeJson = readJson(paths.claudeJson);
  const userMcp = new Set([...keysOf(userSettings?.mcpServers), ...keysOf(claudeJson?.mcpServers)]);
  for (const name of stringsOf(claudeJson?.disabledMcpServers)) userMcp.delete(name);

  let claudeMdCount = exists(user.claudeMd) ? 1 : 0;
  let rulesCount = countRules(user.rules);
  let hooksCount = keysOf(userSettings?.hooks).length;
  const projectMcp = new Set<string>();

  if (project) {
    claudeMdCount += [exists(project.claudeMd), exists(project.localMd), exists(project.dotClaudeMd), exists(project.dotLocalMd)]
      .filter(Boolean).length;
    if (project.rules) rulesCount += countRules(project.rules);
    const projectSettings = project.settings ? readJson(project.settings) : null;
    for (const name of keysOf(projectSettings?.mcpServers)) projectMcp.add(name);
    hooksCount += keysOf(projectSettings?.hooks).length;

    const localSettings = readJson(project.localSettings);
    for (const name of keysOf(localSettings?.mcpServers)) projectMcp.add(name);
    hooksCount += keysOf(localSettings?.hooks).length;

    const disabledMcpJson = new Set(stringsOf(localSettings?.disabledMcpjsonServers));
    for (const name of keysOf(readJson(project.mcpJson)?.mcpServers)) {
      if (!disabledMcpJson.has(name)) projectMcp.add(name);
    }
  }

  // A server named in both scopes counts twice: they are separate configs.
  return { claudeMdCount, rulesCount, mcpCount: userMcp.size + projectMcp.size, hooksCount };
}
