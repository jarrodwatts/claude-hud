import { loadConfig } from './config.js';
import { countConfigs } from './config-reader.js';
import { parseExtraCmdArg, runExtraCmd } from './extra-cmd.js';
import { getGitStatus } from './git.js';
import { render } from './render/index.js';
import { readStdin } from './stdin.js';
import { parseTranscript } from './transcript.js';
import { getUsage } from './usage-api.js';
export type MainDeps = {
    readStdin: typeof readStdin;
    parseTranscript: typeof parseTranscript;
    countConfigs: typeof countConfigs;
    getGitStatus: typeof getGitStatus;
    getUsage: typeof getUsage;
    loadConfig: typeof loadConfig;
    parseExtraCmdArg: typeof parseExtraCmdArg;
    runExtraCmd: typeof runExtraCmd;
    render: typeof render;
    now: () => number;
    log: (...args: unknown[]) => void;
};
export declare function main(overrides?: Partial<MainDeps>): Promise<void>;
export declare function formatSessionDuration(sessionStart?: Date, now?: () => number): string;
//# sourceMappingURL=index.d.ts.map