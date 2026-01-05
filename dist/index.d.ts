import { readStdin } from './stdin.js';
import { parseTranscript } from './transcript.js';
import { render } from './render/index.js';
import { countConfigs } from './config-reader.js';
import { getGitBranch, getGitDirty } from './git.js';
export type MainDeps = {
    readStdin: typeof readStdin;
    parseTranscript: typeof parseTranscript;
    countConfigs: typeof countConfigs;
    getGitBranch: typeof getGitBranch;
    getGitDirty: typeof getGitDirty;
    render: typeof render;
    now: () => number;
    log: (...args: unknown[]) => void;
};
export declare function main(overrides?: Partial<MainDeps>): Promise<void>;
export declare function formatSessionDuration(sessionStart?: Date, now?: () => number): string;
//# sourceMappingURL=index.d.ts.map