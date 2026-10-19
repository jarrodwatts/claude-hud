import type { AgentEntry, TranscriptData } from './types.js';
export declare function parseTranscript(transcriptPath: string, homeDir: string): Promise<TranscriptData>;
/** Sets each agent's effort in place; agents without a known id or first reply stay without one. */
export declare function addSubagentEfforts(transcriptPath: string, agents: AgentEntry[]): Promise<void>;
//# sourceMappingURL=transcript.d.ts.map