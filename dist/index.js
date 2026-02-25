import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { countConfigs } from './config-reader.js';
import { parseExtraCmdArg, runExtraCmd } from './extra-cmd.js';
import { getGitStatus } from './git.js';
import { render } from './render/index.js';
import { readStdin } from './stdin.js';
import { parseTranscript } from './transcript.js';
import { getUsage } from './usage-api.js';
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
            deps.log('[claude-hud] Initializing...');
            return;
        }
        const transcriptPath = stdin.transcript_path ?? '';
        const extraCmd = deps.parseExtraCmdArg();
        // Tier 1: independent operations in parallel
        const [transcript, configCounts, config] = await Promise.all([
            deps.parseTranscript(transcriptPath),
            deps.countConfigs(stdin.cwd),
            deps.loadConfig(),
        ]);
        const { claudeMdCount, rulesCount, mcpCount, hooksCount } = configCounts;
        // Tier 2: config-dependent operations in parallel
        const [gitStatus, usageData, extraLabel] = await Promise.all([
            config.gitStatus.enabled ? deps.getGitStatus(stdin.cwd) : Promise.resolve(null),
            config.display.showUsage !== false ? deps.getUsage() : Promise.resolve(null),
            extraCmd ? deps.runExtraCmd(extraCmd) : Promise.resolve(null),
        ]);
        const sessionDuration = formatSessionDuration(transcript.sessionStart, deps.now);
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
        };
        deps.render(ctx);
    }
    catch (error) {
        deps.log('[claude-hud] Error:', error instanceof Error ? error.message : 'Unknown error');
    }
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