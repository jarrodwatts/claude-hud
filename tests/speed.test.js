import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getOutputSpeed } from '../dist/speed.js';

const frame = (output, apiMs, input = 1000) => ({
  transcript_path: '/tmp/session.jsonl',
  context_window: { current_usage: { input_tokens: input, output_tokens: output } },
  cost: { total_api_duration_ms: apiMs },
});

test('speed is the finished response over the API time it added, held until the next', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'hud-speed-'));
  const previous = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = path.join(home, '.claude');
  try {
    assert.equal(getOutputSpeed(frame(0, 1000), home), null);
    assert.equal(getOutputSpeed(frame(400, 5000), home), 100);
    assert.equal(getOutputSpeed(frame(400, 5000), home), 100, 'same frame keeps the reading');
    assert.equal(getOutputSpeed(frame(400, 9000), home), 100, 'API time with unchanged usage folds into the baseline');
    assert.equal(getOutputSpeed(frame(300, 9200, 2000), home), 100, 'under 500ms of API time is too noisy to measure');
    assert.equal(getOutputSpeed(frame(300, 12_000, 3000), home)?.toFixed(1), (300 / 2.8).toFixed(1));
    assert.equal(getOutputSpeed(frame(300, 100, 4000), home), null, 'a reset counter starts over');
    assert.equal(getOutputSpeed({ ...frame(300, 100), transcript_path: undefined }, home), null);
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previous;
    await rm(home, { recursive: true, force: true });
  }
});
