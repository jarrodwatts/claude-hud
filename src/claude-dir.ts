import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';

/**
 * Get the Claude config directory, respecting CLAUDE_CONFIG_DIR env var.
 * Falls back to homeDir/.claude (defaults to os.homedir()).
 *
 * When homeDir is explicitly provided (e.g. from dependency-injected tests),
 * it takes precedence over the env var to preserve test isolation.
 */
export function getClaudeDir(homeDir?: string): string {
  if (homeDir) {
    return path.join(homeDir, '.claude');
  }
  const envDir = process.env.CLAUDE_CONFIG_DIR;
  if (envDir) {
    return envDir;
  }
  return path.join(os.homedir(), '.claude');
}

/**
 * Get the macOS Keychain service name for Claude Code credentials.
 * When CLAUDE_CONFIG_DIR is set, Claude Code appends a suffix derived
 * from SHA256(configDirPath)[:8] to distinguish multiple instances.
 */
export function getKeychainServiceName(): string {
  const base = 'Claude Code-credentials';
  const envDir = process.env.CLAUDE_CONFIG_DIR;
  if (!envDir) {
    return base;
  }
  const hash = crypto.createHash('sha256').update(envDir).digest('hex').slice(0, 8);
  return `${base}-${hash}`;
}
