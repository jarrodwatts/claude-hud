import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getSessionStats, updateSessionStats } from '../dist/session-stats.js';

describe('session-stats', () => {
  let cacheDir;
  beforeEach(() => { cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-stats-test-')); });
  afterEach(() => { fs.rmSync(cacheDir, { recursive: true, force: true }); });

  it('initializes with zero stats', () => {
    const stats = getSessionStats(cacheDir);
    assert.strictEqual(stats.totalToolCalls, 0);
    assert.strictEqual(stats.autocompactCount, 0);
    assert.strictEqual(stats.peakContextPercent, 0);
  });

  it('tracks peak context percent', () => {
    updateSessionStats(cacheDir, { contextPercent: 45, toolCount: 5, agentCount: 1 });
    updateSessionStats(cacheDir, { contextPercent: 72, toolCount: 8, agentCount: 1 });
    updateSessionStats(cacheDir, { contextPercent: 60, toolCount: 10, agentCount: 2 });
    const stats = getSessionStats(cacheDir);
    assert.strictEqual(stats.peakContextPercent, 72);
    assert.strictEqual(stats.totalToolCalls, 10);
    assert.strictEqual(stats.totalAgentRuns, 2);
  });

  it('detects autocompact after sustained drop', () => {
    updateSessionStats(cacheDir, { contextPercent: 85, toolCount: 10, agentCount: 0 });
    updateSessionStats(cacheDir, { contextPercent: 40, toolCount: 10, agentCount: 0 });
    updateSessionStats(cacheDir, { contextPercent: 42, toolCount: 11, agentCount: 0 });
    const stats = getSessionStats(cacheDir);
    assert.strictEqual(stats.autocompactCount, 1);
  });

  it('does not false-positive on small drops', () => {
    updateSessionStats(cacheDir, { contextPercent: 50, toolCount: 5, agentCount: 0 });
    updateSessionStats(cacheDir, { contextPercent: 45, toolCount: 6, agentCount: 0 });
    updateSessionStats(cacheDir, { contextPercent: 43, toolCount: 7, agentCount: 0 });
    const stats = getSessionStats(cacheDir);
    assert.strictEqual(stats.autocompactCount, 0);
  });
});
