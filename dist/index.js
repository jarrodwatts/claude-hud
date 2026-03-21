import { readStdin, getContextPercent } from './stdin.js';
import { parseTranscript } from './transcript.js';
import { render } from './render/index.js';
import { countConfigs } from './config-reader.js';
import { getGitStatus } from './git.js';
import { getUsage } from './usage-api.js';
import { loadConfig } from './config.js';
import { parseExtraCmdArg, runExtraCmd } from './extra-cmd.js';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { getDefaultCacheDir } from './cache.js';
import { loadProviders, fetchAllProviders } from './providers/index.js';
import { evaluateAlerts, shouldBell } from './alert.js';
import { calculateBurnRate, recordTokenSnapshot } from './burn-rate.js';
import { updateSessionStats, getSessionStats } from './session-stats.js';
export async function main(overrides = {}) {
    const deps = {
        readStdin,
        parseTranscript,
        countConfigs,
        getGitStatus,
        getUsage,
        loadConfig,
        parseExtraCmdArg,
        runExtraCmd,
        render,
        now: () => Date.now(),
        log: console.log,
        ...overrides,
    };
    try {
        const stdin = await deps.readStdin();
        if (!stdin) {
            // Running without stdin - this happens during setup verification
            const isMacOS = process.platform === 'darwin';
            deps.log('[claude-hud] Initializing...');
            if (isMacOS) {
                deps.log('[claude-hud] Note: On macOS, you may need to restart Claude Code for the HUD to appear.');
            }
            return;
        }
        const transcriptPath = stdin.transcript_path ?? '';
        const transcript = await deps.parseTranscript(transcriptPath);
        const { claudeMdCount, rulesCount, mcpCount, hooksCount } = await deps.countConfigs(stdin.cwd);
        const config = await deps.loadConfig();
        const gitStatus = config.gitStatus.enabled
            ? await deps.getGitStatus(stdin.cwd)
            : null;
        // Only fetch usage if enabled in config (replaces env var requirement)
        const usageData = config.display.showUsage !== false
            ? await deps.getUsage({
                ttls: {
                    cacheTtlMs: config.usage.cacheTtlSeconds * 1000,
                    failureCacheTtlMs: config.usage.failureCacheTtlSeconds * 1000,
                },
            })
            : null;
        const extraCmd = deps.parseExtraCmdArg();
        const extraLabel = extraCmd ? await deps.runExtraCmd(extraCmd) : null;
        const sessionDuration = formatSessionDuration(transcript.sessionStart, deps.now);
        const cacheDir = getDefaultCacheDir();
        // Framework providers
        let frameworkStatus = [];
        if (config.display.showFrameworks) {
            const providers = loadProviders(config.frameworks, cacheDir);
            frameworkStatus = await fetchAllProviders(providers);
        }
        // Burn rate
        let burnRate = null;
        const inputTokens = stdin.context_window?.current_usage?.input_tokens;
        const contextSize = stdin.context_window?.context_window_size;
        if (config.display.showBurnRate && inputTokens != null && contextSize != null) {
            recordTokenSnapshot(inputTokens, cacheDir);
            burnRate = calculateBurnRate(inputTokens, contextSize, cacheDir);
        }
        // Context percent
        const contextPercent = getContextPercent(stdin);
        // Session stats
        updateSessionStats(cacheDir, {
            contextPercent,
            toolCount: transcript.tools.length,
            agentCount: transcript.agents.length,
        });
        const sessionStats = getSessionStats(cacheDir);
        // Alerts
        let alerts = [];
        if (config.display.showAlerts) {
            alerts = evaluateAlerts({
                contextPercent,
                usage5hPercent: usageData?.fiveHour ?? 0,
                usage7dPercent: usageData?.sevenDay ?? 0,
                estimatedCallsRemaining: burnRate?.estimatedCallsRemaining ?? null,
                usageResetTime: usageData?.fiveHourResetAt
                    ? formatResetTimeForAlert(usageData.fiveHourResetAt)
                    : null,
                alertConfig: config.alerts,
                cacheDir,
            });
            if (shouldBell(alerts, cacheDir)) {
                process.stderr.write('\x07');
            }
        }
        const ctx = {
            stdin,
            transcript,
            claudeMdCount,
            rulesCount,
            mcpCount,
            hooksCount,
            sessionDuration,
            gitStatus,
            usageData,
            config,
            extraLabel,
            frameworkStatus,
            alerts,
            burnRate,
            sessionStats,
        };
        deps.render(ctx);
    }
    catch (error) {
        deps.log('[claude-hud] Error:', error instanceof Error ? error.message : 'Unknown error');
    }
}
export function formatResetTimeForAlert(resetAt) {
    const now = new Date();
    const diffMs = resetAt.getTime() - now.getTime();
    if (diffMs <= 0)
        return 'now';
    const mins = Math.ceil(diffMs / 60000);
    if (mins < 60)
        return `${mins}m`;
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
}
export function formatSessionDuration(sessionStart, now = () => Date.now()) {
    if (!sessionStart) {
        return '';
    }
    const ms = now() - sessionStart.getTime();
    const mins = Math.floor(ms / 60000);
    if (mins < 1)
        return '<1m';
    if (mins < 60)
        return `${mins}m`;
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return `${hours}h ${remainingMins}m`;
}
const scriptPath = fileURLToPath(import.meta.url);
const argvPath = process.argv[1];
const isSamePath = (a, b) => {
    try {
        return realpathSync(a) === realpathSync(b);
    }
    catch {
        return a === b;
    }
};
if (argvPath && isSamePath(argvPath, scriptPath)) {
    void main();
}
//# sourceMappingURL=index.js.map