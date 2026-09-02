import * as path from 'node:path';

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
  const configDir = getClaudeConfigDir(homeDir);
  const defaultConfigDir = path.join(homeDir, '.claude');
  if (configDir === defaultConfigDir) {
    // Default profile — whether CLAUDE_CONFIG_DIR is unset, or explicitly
    // set to the same location as the default (e.g. `CLAUDE_CONFIG_DIR=~/.claude`) —
    // Claude Code stores its state file as a sibling of ~/.claude, not nested
    // inside it.
    return path.join(homeDir, '.claude.json');
  }
  // Custom CLAUDE_CONFIG_DIR (resolves somewhere other than the default):
  // Claude Code nests the state file *inside* the configured directory
  // (e.g. $CLAUDE_CONFIG_DIR/.claude.json), not as a sibling.
  return path.join(configDir, '.claude.json');
}

export function getHudPluginDir(homeDir: string): string {
  return path.join(getClaudeConfigDir(homeDir), 'plugins', 'claude-hud');
}
