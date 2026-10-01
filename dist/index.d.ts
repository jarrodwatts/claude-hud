import { readStdin, getUsageFromStdin } from "./stdin.js";
import { parseTranscript } from "./transcript.js";
import { render } from "./render/index.js";
import { countConfigs } from "./config-reader.js";
import { getGitStatus } from "./git.js";
import { getJjStatus, isJjRepo } from "./jj.js";
import { loadConfig } from "./config.js";
import { parseExtraCmdArg, runExtraCmd } from "./extra-cmd.js";
import { getClaudeCodeVersion } from "./version.js";
import { getMemoryUsage } from "./memory.js";
import { readAuthInfo } from "./auth.js";
import { applyContextWindowFallback } from "./context-cache.js";
import { getUsageFromExternalSnapshot, writeExternalUsageSnapshot } from "./external-usage.js";
import type { GitRepoIdentity, GitStatus } from "./git.js";
import type { HudConfig } from "./config.js";
export { getUsageFromExternalSnapshot, writeExternalUsageSnapshot } from "./external-usage.js";
export type MainDeps = {
    readStdin: typeof readStdin;
    getUsageFromStdin: typeof getUsageFromStdin;
    getUsageFromExternalSnapshot: typeof getUsageFromExternalSnapshot;
    writeExternalUsageSnapshot: typeof writeExternalUsageSnapshot;
    parseTranscript: typeof parseTranscript;
    countConfigs: typeof countConfigs;
    getGitStatus: typeof getGitStatus;
    getJjStatus: typeof getJjStatus;
    isJjRepo: typeof isJjRepo;
    loadConfig: typeof loadConfig;
    parseExtraCmdArg: typeof parseExtraCmdArg;
    runExtraCmd: typeof runExtraCmd;
    getClaudeCodeVersion: typeof getClaudeCodeVersion;
    getMemoryUsage: typeof getMemoryUsage;
    readAuthInfo: typeof readAuthInfo;
    applyContextWindowFallback: typeof applyContextWindowFallback;
    render: typeof render;
    now: () => number;
    log: (...args: unknown[]) => void;
};
/**
 * Returns true when the HUD is disabled for this invocation via the
 * CLAUDE_HUD_DISABLE environment variable. Any non-blank value other than an
 * explicit negative (`0`, `false`, `off`, `no`, case-insensitive) disables the
 * HUD, so users can launch sessions without it (`CLAUDE_HUD_DISABLE=1 claude`)
 * while keeping the statusLine entry in settings.json intact.
 */
export declare function isHudDisabled(env?: NodeJS.ProcessEnv): boolean;
/**
 * Prefers jj when an eligible `.jj` marker is found and the opt-in is enabled.
 * If the bounded jj probe fails, Git remains the safe compatibility fallback.
 */
export declare function resolveVcsStatus(deps: Pick<MainDeps, "getGitStatus" | "getJjStatus" | "isJjRepo">, config: HudConfig, cwd?: string, repo?: GitRepoIdentity | null): Promise<GitStatus | null>;
export declare function main(overrides?: Partial<MainDeps>): Promise<void>;
export declare function formatSessionDuration(sessionStart?: Date, now?: () => number): string;
//# sourceMappingURL=index.d.ts.map