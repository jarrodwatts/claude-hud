import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isLimitReached, isModelQuotaExhausted, getMostRestrictiveQuota } from '../dist/types.js';
import { parseTranscript } from '../dist/transcript.js';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// ============================================================
// getMostRestrictiveQuota Tests
// ============================================================

describe('getMostRestrictiveQuota', () => {
    test('returns null when no model quotas exist', () => {
        const result = getMostRestrictiveQuota({
            planName: 'Max',
            fiveHour: 30,
            sevenDay: 10,
            fiveHourResetAt: null,
            sevenDayResetAt: null,
        });
        assert.equal(result, null);
    });

    test('returns null when modelQuotas is empty array', () => {
        const result = getMostRestrictiveQuota({
            planName: 'Max',
            fiveHour: 30,
            sevenDay: 10,
            fiveHourResetAt: null,
            sevenDayResetAt: null,
            modelQuotas: [],
        });
        assert.equal(result, null);
    });

    test('returns the quota with highest utilization', () => {
        const result = getMostRestrictiveQuota({
            planName: 'Max',
            fiveHour: 30,
            sevenDay: 10,
            fiveHourResetAt: null,
            sevenDayResetAt: null,
            modelQuotas: [
                {
                    modelId: 'sonnet_4',
                    displayName: 'Sonnet 4',
                    weeklyHoursUsed: null,
                    weeklyHoursLimit: null,
                    tokensUsed: null,
                    tokensLimit: null,
                    utilization: 30,
                    resetsAt: null,
                },
                {
                    modelId: 'opus_4_5',
                    displayName: 'Opus 4.5',
                    weeklyHoursUsed: 4,
                    weeklyHoursLimit: 5,
                    tokensUsed: null,
                    tokensLimit: null,
                    utilization: 80,
                    resetsAt: null,
                },
                {
                    modelId: 'haiku_3_5',
                    displayName: 'Haiku 3.5',
                    weeklyHoursUsed: null,
                    weeklyHoursLimit: null,
                    tokensUsed: null,
                    tokensLimit: null,
                    utilization: 10,
                    resetsAt: null,
                },
            ],
        });
        assert.notEqual(result, null);
        assert.equal(result.modelId, 'opus_4_5');
        assert.equal(result.utilization, 80);
    });

    test('handles null utilization values', () => {
        const result = getMostRestrictiveQuota({
            planName: 'Max',
            fiveHour: 30,
            sevenDay: 10,
            fiveHourResetAt: null,
            sevenDayResetAt: null,
            modelQuotas: [
                {
                    modelId: 'model_a',
                    displayName: 'Model A',
                    weeklyHoursUsed: null,
                    weeklyHoursLimit: null,
                    tokensUsed: null,
                    tokensLimit: null,
                    utilization: null,
                    resetsAt: null,
                },
                {
                    modelId: 'model_b',
                    displayName: 'Model B',
                    weeklyHoursUsed: null,
                    weeklyHoursLimit: null,
                    tokensUsed: null,
                    tokensLimit: null,
                    utilization: 50,
                    resetsAt: null,
                },
            ],
        });
        assert.notEqual(result, null);
        assert.equal(result.modelId, 'model_b');
    });
});

// ============================================================
// isModelQuotaExhausted Tests
// ============================================================

describe('isModelQuotaExhausted', () => {
    test('returns true when model utilization is 100%', () => {
        const data = {
            planName: 'Max',
            fiveHour: 30,
            sevenDay: 10,
            fiveHourResetAt: null,
            sevenDayResetAt: null,
            modelQuotas: [{
                modelId: 'opus_4_5',
                displayName: 'Opus 4.5',
                weeklyHoursUsed: 5,
                weeklyHoursLimit: 5,
                tokensUsed: null,
                tokensLimit: null,
                utilization: 100,
                resetsAt: null,
            }],
        };
        assert.equal(isModelQuotaExhausted(data, 'opus_4_5'), true);
    });

    test('returns false when model utilization is below 100%', () => {
        const data = {
            planName: 'Max',
            fiveHour: 30,
            sevenDay: 10,
            fiveHourResetAt: null,
            sevenDayResetAt: null,
            modelQuotas: [{
                modelId: 'opus_4_5',
                displayName: 'Opus 4.5',
                weeklyHoursUsed: 3,
                weeklyHoursLimit: 5,
                tokensUsed: null,
                tokensLimit: null,
                utilization: 60,
                resetsAt: null,
            }],
        };
        assert.equal(isModelQuotaExhausted(data, 'opus_4_5'), false);
    });

    test('returns false when model is not found', () => {
        const data = {
            planName: 'Max',
            fiveHour: 30,
            sevenDay: 10,
            fiveHourResetAt: null,
            sevenDayResetAt: null,
            modelQuotas: [{
                modelId: 'opus_4_5',
                displayName: 'Opus 4.5',
                weeklyHoursUsed: 5,
                weeklyHoursLimit: 5,
                tokensUsed: null,
                tokensLimit: null,
                utilization: 100,
                resetsAt: null,
            }],
        };
        assert.equal(isModelQuotaExhausted(data, 'nonexistent_model'), false);
    });

    test('returns false when no modelQuotas exist', () => {
        const data = {
            planName: 'Max',
            fiveHour: 30,
            sevenDay: 10,
            fiveHourResetAt: null,
            sevenDayResetAt: null,
        };
        assert.equal(isModelQuotaExhausted(data, 'opus_4_5'), false);
    });
});

// ============================================================
// Transcript lastUserMessage Tests
// ============================================================

describe('transcript lastUserMessage parsing', () => {
    let tempDir;

    async function createTranscript(lines) {
        tempDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-transcript-'));
        const filePath = path.join(tempDir, 'transcript.jsonl');
        await writeFile(filePath, lines.join('\n'), 'utf8');
        return filePath;
    }

    test('extracts last user message from transcript', async () => {
        const filePath = await createTranscript([
            JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:00Z', message: { content: [{ type: 'text', text: 'First message' }] } }),
            JSON.stringify({ type: 'assistant', timestamp: '2026-01-01T00:00:01Z', message: { content: [{ type: 'text', text: 'Response' }] } }),
            JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:02Z', message: { content: [{ type: 'text', text: 'Second message' }] } }),
        ]);

        const result = await parseTranscript(filePath);
        assert.equal(result.lastUserMessage, 'Second message');
        await rm(tempDir, { recursive: true, force: true });
    });

    test('returns undefined when no user messages', async () => {
        const filePath = await createTranscript([
            JSON.stringify({ type: 'assistant', timestamp: '2026-01-01T00:00:00Z', message: { content: [{ type: 'text', text: 'Hello' }] } }),
        ]);

        const result = await parseTranscript(filePath);
        assert.equal(result.lastUserMessage, undefined);
        await rm(tempDir, { recursive: true, force: true });
    });

    test('handles string content in user messages', async () => {
        const filePath = await createTranscript([
            JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:00Z', message: { content: 'Plain text message' } }),
        ]);

        const result = await parseTranscript(filePath);
        assert.equal(result.lastUserMessage, 'Plain text message');
        await rm(tempDir, { recursive: true, force: true });
    });

    test('collapses whitespace in user messages', async () => {
        const filePath = await createTranscript([
            JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:00Z', message: { content: [{ type: 'text', text: 'Hello\n  world\n\n  foo' }] } }),
        ]);

        const result = await parseTranscript(filePath);
        assert.equal(result.lastUserMessage, 'Hello world foo');
        await rm(tempDir, { recursive: true, force: true });
    });

    test('skips interrupted request messages', async () => {
        const filePath = await createTranscript([
            JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:00Z', message: { content: [{ type: 'text', text: 'Real message' }] } }),
            JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:01Z', message: { content: [{ type: 'text', text: '[Request interrupted by user]' }] } }),
        ]);

        const result = await parseTranscript(filePath);
        assert.equal(result.lastUserMessage, 'Real message');
        await rm(tempDir, { recursive: true, force: true });
    });

    test('skips cancelled request messages', async () => {
        const filePath = await createTranscript([
            JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:00Z', message: { content: [{ type: 'text', text: 'Good message' }] } }),
            JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:01Z', message: { content: [{ type: 'text', text: '[Request cancelled by user]' }] } }),
        ]);

        const result = await parseTranscript(filePath);
        assert.equal(result.lastUserMessage, 'Good message');
        await rm(tempDir, { recursive: true, force: true });
    });

    test('handles mixed tool_use and user messages', async () => {
        const filePath = await createTranscript([
            JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:00Z', message: { content: [{ type: 'text', text: 'Fix the bug' }] } }),
            JSON.stringify({ timestamp: '2026-01-01T00:00:01Z', message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { path: 'foo.ts' } }] } }),
            JSON.stringify({ timestamp: '2026-01-01T00:00:02Z', message: { content: [{ type: 'tool_result', tool_use_id: 't1' }] } }),
            JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:03Z', message: { content: [{ type: 'text', text: 'Now deploy it' }] } }),
        ]);

        const result = await parseTranscript(filePath);
        assert.equal(result.lastUserMessage, 'Now deploy it');
        await rm(tempDir, { recursive: true, force: true });
    });
});
