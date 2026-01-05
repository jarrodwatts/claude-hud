import { readStdin } from './stdin.js';
import { parseTranscript } from './transcript.js';
import { render } from './render/index.js';
import { countConfigs } from './config-reader.js';
import { fileURLToPath } from 'node:url';
export async function main(overrides = {}) {
    const deps = {
        readStdin,
        parseTranscript,
        countConfigs,
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
        const transcript = await deps.parseTranscript(transcriptPath);
        const { claudeMdCount, rulesCount, mcpCount, hooksCount } = await deps.countConfigs(stdin.cwd);
        const sessionDuration = formatSessionDuration(transcript.sessionStart, deps.now);
        const ctx = {
            stdin,
            transcript,
            claudeMdCount,
            rulesCount,
            mcpCount,
            hooksCount,
            sessionDuration,
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
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    void main();
}
//# sourceMappingURL=index.js.map