import type { TranscriptData } from './types.js';
/**
 * Max bytes to read from end of transcript file.
 * 100KB covers ~200-400 tool calls, well above the display cap (20 tools, 10 agents).
 * For files smaller than this, the entire file is read.
 */
export declare const TAIL_BYTES: number;
export declare function parseTranscript(transcriptPath: string): Promise<TranscriptData>;
//# sourceMappingURL=transcript.d.ts.map