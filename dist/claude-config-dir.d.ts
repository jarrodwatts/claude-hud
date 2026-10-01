export declare function expandHomeDirPrefix(inputPath: string, homeDir: string): string;
export declare function getClaudeConfigDir(homeDir: string): string;
/**
 * Path of Claude Code's top-level config file (oauthAccount, mcpServers, …).
 *
 * With CLAUDE_CONFIG_DIR set, Claude Code keeps it INSIDE that directory as `.claude.json`. With the default config directory it instead lives BESIDE it as `~/.claude.json`, not inside `~/.claude/`.
 */
export declare function getClaudeConfigJsonPath(homeDir: string): string;
export declare function getHudPluginDir(homeDir: string): string;
//# sourceMappingURL=claude-config-dir.d.ts.map