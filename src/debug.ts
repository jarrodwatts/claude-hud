// Shared debug logging utility
// Enable via: DEBUG=claude-hud or DEBUG=*

function isClaudeHudDebugEnabled(value: string | undefined): boolean {
  if (!value) return false;

  return value
    .split(/[,\s]+/)
    .filter(Boolean)
    .some((token) => token === '*' || token === 'claude-hud' || token.startsWith('claude-hud:'));
}

const DEBUG = isClaudeHudDebugEnabled(process.env.DEBUG);

/**
 * Create a namespaced debug logger
 * @param namespace - Tag for log messages (e.g., 'config', 'usage')
 */
export function createDebug(namespace: string) {
  return function debug(msg: string, ...args: unknown[]): void {
    if (DEBUG) {
      console.error(`[claude-hud:${namespace}] ${msg}`, ...args);
    }
  };
}
