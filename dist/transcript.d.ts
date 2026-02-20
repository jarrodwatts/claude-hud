import type { TranscriptData } from './types.js';
export declare function parseTranscript(transcriptPath: string): Promise<TranscriptData>;
export interface RecentMessagesResult {
    turnCount: number;
    text: string;
}
export declare function extractRecentMessages(transcriptPath: string, maxMessages?: number): Promise<RecentMessagesResult>;
//# sourceMappingURL=transcript.d.ts.map