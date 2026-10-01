/**
 * Authentication info for the current Claude Code login, derived from the
 * `oauthAccount` block Claude Code persists in ~/.claude.json, or
 * $CLAUDE_CONFIG_DIR/.claude.json when the config directory is overridden.
 *
 *   method: human-readable auth/plan label (e.g. "Claude Max 20x", "API Key")
 *   user:   account identifier (email local part, falling back to displayName)
 */
export interface AuthInfo {
    method: string | null;
    user: string | null;
}
/**
 * Derives auth info from the parsed contents of claude.json.
 * Pure so it can be tested without touching the filesystem.
 */
export declare function deriveAuthInfo(claudeJson: unknown, env?: NodeJS.ProcessEnv): AuthInfo;
/**
 * Reads auth info for the current login. Never throws.
 *
 * claude.json is the user's entire CLI config and grows with project history —
 * 73 KB on the host this was measured on. The status line runs on every
 * interaction, so parsing it per tick is not free. The two derived fields are
 * cached against the file's (mtimeMs, ctimeMs, size, dev, ino) identity instead,
 * making the steady-state cost a stat plus a ~100-byte read.
 */
export declare function readAuthInfo(): AuthInfo;
export declare function truncateUser(user: string, maxLength: number): string;
/**
 * Builds the standalone auth segment for the end of the first HUD line,
 * honoring the showAuth / showAuthUser / authUserLength display settings.
 * Returns e.g. "Claude Max 20x · yukinosh…", or null when nothing to show.
 */
export declare function formatAuthSegment(info: AuthInfo | null | undefined, display: {
    showAuth?: boolean;
    showAuthUser?: boolean;
    authUserLength?: number;
} | undefined): string | null;
//# sourceMappingURL=auth.d.ts.map