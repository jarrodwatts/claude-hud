import * as path from 'node:path';
export function expandHomeDirPrefix(inputPath, homeDir) {
    if (inputPath === '~') {
        return homeDir;
    }
    if (inputPath.startsWith('~/') || inputPath.startsWith('~\\')) {
        return path.join(homeDir, inputPath.slice(2));
    }
    return inputPath;
}
export function getClaudeConfigDir(homeDir) {
    const envConfigDir = process.env.CLAUDE_CONFIG_DIR?.trim();
    if (!envConfigDir) {
        return path.join(homeDir, '.claude');
    }
    return path.resolve(expandHomeDirPrefix(envConfigDir, homeDir));
}
/**
 * Path of Claude Code's top-level config file (oauthAccount, mcpServers, …).
 *
 * With CLAUDE_CONFIG_DIR set, Claude Code keeps it INSIDE that directory as `.claude.json`. With the default config directory it instead lives BESIDE it as `~/.claude.json`, not inside `~/.claude/`.
 */
export function getClaudeConfigJsonPath(homeDir) {
    const envConfigDir = process.env.CLAUDE_CONFIG_DIR?.trim();
    if (!envConfigDir) {
        return path.join(homeDir, '.claude.json');
    }
    return path.join(getClaudeConfigDir(homeDir), '.claude.json');
}
export function getHudPluginDir(homeDir) {
    return path.join(getClaudeConfigDir(homeDir), 'plugins', 'claude-hud');
}
//# sourceMappingURL=claude-config-dir.js.map