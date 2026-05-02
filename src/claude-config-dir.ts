import * as path from 'node:path';
import * as fs from 'node:fs';

function expandHomeDirPrefix(inputPath: string, homeDir: string): string {
  if (inputPath === '~') {
    return homeDir;
  }
  if (inputPath.startsWith('~/') || inputPath.startsWith('~\\')) {
    return path.join(homeDir, inputPath.slice(2));
  }
  return inputPath;
}

export function getClaudeConfigDir(homeDir: string): string {
  const envConfigDir = process.env.CLAUDE_CONFIG_DIR?.trim();
  if (!envConfigDir) {
    return path.join(homeDir, '.claude');
  }
  return path.resolve(expandHomeDirPrefix(envConfigDir, homeDir));
}

export function getClaudeConfigJsonPath(homeDir: string): string {
  return `${getClaudeConfigDir(homeDir)}.json`;
}

/**
 * Returns the legacy plugin directory path (~/.claude/plugins/claude-hud/).
 * Used as fallback and for migration source detection.
 */
export function getLegacyHudPluginDir(homeDir: string): string {
  return path.join(getClaudeConfigDir(homeDir), 'plugins', 'claude-hud');
}

/**
 * Returns the HUD plugin data directory.
 *
 * Priority:
 * 1. $CLAUDE_PLUGIN_DATA (set by Claude Code plugin runtime)
 * 2. Legacy path (~/.claude/plugins/claude-hud/)
 */
export function getHudPluginDir(homeDir: string): string {
  const envPluginData = process.env.CLAUDE_PLUGIN_DATA?.trim();
  if (envPluginData) {
    return path.resolve(expandHomeDirPrefix(envPluginData, homeDir));
  }
  return getLegacyHudPluginDir(homeDir);
}

/**
 * One-time migration from legacy path to $CLAUDE_PLUGIN_DATA.
 * If the legacy dir exists and the new dir does not, moves data over.
 * Safe to call on every startup — no-ops when migration is unnecessary.
 */
export function migrateDataDirIfNeeded(homeDir: string): void {
  const newDir = getHudPluginDir(homeDir);
  const legacyDir = getLegacyHudPluginDir(homeDir);

  // No migration needed if paths are the same or legacy doesn't exist
  if (newDir === legacyDir) return;
  if (!fs.existsSync(legacyDir)) return;
  if (fs.existsSync(newDir)) return;

  // Ensure parent directory exists
  fs.mkdirSync(path.dirname(newDir), { recursive: true });
  fs.renameSync(legacyDir, newDir);
}
