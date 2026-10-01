import * as path from 'node:path';

export function expandHomeDirPrefix(inputPath: string, homeDir: string): string {
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

// Claude Code keeps .claude.json inside CLAUDE_CONFIG_DIR when it is set, otherwise in the home directory.
export function getClaudeConfigJsonPath(homeDir: string): string {
  const envConfigDir = process.env.CLAUDE_CONFIG_DIR?.trim();
  if (!envConfigDir) {
    return path.join(homeDir, '.claude.json');
  }
  return path.join(getClaudeConfigDir(homeDir), '.claude.json');
}

export function getHudPluginDir(homeDir: string): string {
  return path.join(getClaudeConfigDir(homeDir), 'plugins', 'claude-hud');
}
