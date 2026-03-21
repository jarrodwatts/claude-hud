import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Import from dist/
import { readCache, writeCache } from '../dist/cache.js';
import { calculateBurnRate, recordTokenSnapshot } from '../dist/burn-rate.js';
import { getSessionStats, updateSessionStats } from '../dist/session-stats.js';
import { evaluateAlerts } from '../dist/alert.js';
import { estimateCost, formatCost } from '../dist/cost-tracker.js';
import { renderFrameworkLine } from '../dist/render/framework-line.js';
import { renderAlertLine } from '../dist/render/alert-line.js';

describe('enhancement edge cases', () => {
  let cacheDir;
  beforeEach(() => { cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-edge-')); });
  afterEach(() => { fs.rmSync(cacheDir, { recursive: true, force: true }); });

  describe('cache edge cases', () => {
    it('handles corrupted cache file gracefully', () => {
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(path.join(cacheDir, 'cache.json'), 'not json{{{');
      const result = readCache('key', 5000, cacheDir);
      assert.strictEqual(result, null);
    });

    it('handles empty cache file', () => {
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(path.join(cacheDir, 'cache.json'), '');
      const result = readCache('key', 5000, cacheDir);
      assert.strictEqual(result, null);
    });

    it('overwrites existing key', () => {
      writeCache('k', 'v1', cacheDir);
      writeCache('k', 'v2', cacheDir);
      assert.strictEqual(readCache('k', 5000, cacheDir), 'v2');
    });
  });

  describe('burn-rate edge cases', () => {
    it('returns null when tokens decrease (model switch)', () => {
      const now = Date.now();
      recordTokenSnapshot(100000, cacheDir, now - 120000);
      recordTokenSnapshot(80000, cacheDir, now - 60000);
      recordTokenSnapshot(50000, cacheDir, now);
      const result = calculateBurnRate(50000, 200000, cacheDir);
      assert.strictEqual(result, null); // tokens decreased
    });

    it('handles zero context window size', () => {
      const now = Date.now();
      recordTokenSnapshot(40000, cacheDir, now - 120000);
      recordTokenSnapshot(50000, cacheDir, now);
      const result = calculateBurnRate(50000, 0, cacheDir);
      assert.strictEqual(result, null);
    });

    it('handles negative remaining tokens', () => {
      const now = Date.now();
      recordTokenSnapshot(40000, cacheDir, now - 120000);
      recordTokenSnapshot(50000, cacheDir, now);
      const result = calculateBurnRate(250000, 200000, cacheDir);
      // Should not crash, may return 0 or negative calls remaining
      if (result !== null) {
        assert.ok(typeof result.estimatedCallsRemaining === 'number');
      }
    });
  });

  describe('session-stats edge cases', () => {
    it('handles rapid consecutive updates', () => {
      for (let i = 0; i < 10; i++) {
        updateSessionStats(cacheDir, { contextPercent: 50 + i, toolCount: i, agentCount: 0 });
      }
      const stats = getSessionStats(cacheDir);
      assert.strictEqual(stats.peakContextPercent, 59);
      assert.strictEqual(stats.totalToolCalls, 9);
    });

    it('does not count gradual drops as autocompact', () => {
      // Gradual decline: 80 → 75 → 70 → 65
      updateSessionStats(cacheDir, { contextPercent: 80, toolCount: 1, agentCount: 0 });
      updateSessionStats(cacheDir, { contextPercent: 75, toolCount: 2, agentCount: 0 });
      updateSessionStats(cacheDir, { contextPercent: 70, toolCount: 3, agentCount: 0 });
      updateSessionStats(cacheDir, { contextPercent: 65, toolCount: 4, agentCount: 0 });
      const stats = getSessionStats(cacheDir);
      assert.strictEqual(stats.autocompactCount, 0);
    });

    it('counts multiple autocompacts', () => {
      // First autocompact: 90 → 30 → 32
      updateSessionStats(cacheDir, { contextPercent: 90, toolCount: 1, agentCount: 0 });
      updateSessionStats(cacheDir, { contextPercent: 30, toolCount: 2, agentCount: 0 });
      updateSessionStats(cacheDir, { contextPercent: 32, toolCount: 3, agentCount: 0 });
      // Build back up, second autocompact: 85 → 25 → 27
      updateSessionStats(cacheDir, { contextPercent: 60, toolCount: 4, agentCount: 0 });
      updateSessionStats(cacheDir, { contextPercent: 85, toolCount: 5, agentCount: 0 });
      updateSessionStats(cacheDir, { contextPercent: 25, toolCount: 6, agentCount: 0 });
      updateSessionStats(cacheDir, { contextPercent: 27, toolCount: 7, agentCount: 0 });
      const stats = getSessionStats(cacheDir);
      assert.strictEqual(stats.autocompactCount, 2);
    });
  });

  describe('alert edge cases', () => {
    const config = {
      context: { warningThreshold: 70, criticalThreshold: 85, actions: { visual: true, bell: false, predict: true } },
      usage5h: { warningThreshold: 70, criticalThreshold: 90, actions: { visual: true, bell: true, predict: true } },
      usage7d: { warningThreshold: 80, actions: { visual: true, bell: false, predict: true } },
    };

    it('handles all three alert types simultaneously', () => {
      const alerts = evaluateAlerts({
        contextPercent: 92, usage5hPercent: 95, usage7dPercent: 85,
        estimatedCallsRemaining: 5, usageResetTime: '14:00',
        alertConfig: config, cacheDir,
      });
      assert.strictEqual(alerts.length, 3);
    });

    it('handles exactly-at-threshold values', () => {
      const alerts = evaluateAlerts({
        contextPercent: 70, usage5hPercent: 70, usage7dPercent: 80,
        estimatedCallsRemaining: null, usageResetTime: null,
        alertConfig: config, cacheDir,
      });
      assert.strictEqual(alerts.length, 3); // All at exactly the threshold
    });

    it('handles zero percent values', () => {
      const alerts = evaluateAlerts({
        contextPercent: 0, usage5hPercent: 0, usage7dPercent: 0,
        estimatedCallsRemaining: null, usageResetTime: null,
        alertConfig: config, cacheDir,
      });
      assert.strictEqual(alerts.length, 0);
    });
  });

  describe('cost-tracker edge cases', () => {
    it('returns null without model name', () => {
      const result = estimateCost({ model: {} }, cacheDir);
      assert.strictEqual(result, null);
    });

    it('returns null without usage data', () => {
      const result = estimateCost({ model: { display_name: 'Opus' } }, cacheDir);
      assert.strictEqual(result, null);
    });

    it('calculates cost for opus model', () => {
      const result = estimateCost({
        model: { display_name: 'Opus 4.6' },
        context_window: { current_usage: { input_tokens: 100000, output_tokens: 10000 } },
      }, cacheDir);
      assert.ok(result !== null);
      assert.ok(result.sessionCost > 0);
      assert.strictEqual(result.inputCostPer1M, 15);
    });

    it('defaults to sonnet pricing for unknown models', () => {
      const result = estimateCost({
        model: { display_name: 'Unknown Model' },
        context_window: { current_usage: { input_tokens: 1000000, output_tokens: 0 } },
      }, cacheDir);
      assert.ok(result !== null);
      assert.strictEqual(result.inputCostPer1M, 3); // sonnet default
    });

    it('formats costs correctly', () => {
      assert.strictEqual(formatCost(0.001), '$0.0010');
      assert.strictEqual(formatCost(0.50), '$0.50');
      assert.strictEqual(formatCost(5.123), '$5.12');
    });
  });

  describe('framework-line edge cases', () => {
    it('handles provider with empty entries', () => {
      const result = renderFrameworkLine([{ provider: 'AGW', entries: [] }]);
      assert.strictEqual(result, null);
    });

    it('handles unknown provider name', () => {
      const result = renderFrameworkLine([{
        provider: 'Unknown',
        entries: [{ label: 'test', status: 'running' }],
      }]);
      // Should return null since we only handle AGW and Teams
      assert.strictEqual(result, null);
    });

    it('handles all entry statuses', () => {
      const result = renderFrameworkLine([{
        provider: 'AGW',
        entries: [
          { label: 'a', status: 'running' },
          { label: 'b', status: 'completed' },
          { label: 'c', status: 'error' },
          { label: 'd', status: 'waiting' },
        ],
      }]);
      assert.ok(result !== null);
      const stripped = result.replace(/\x1b\[[0-9;]*m/g, '');
      assert.ok(stripped.includes('a'));
      assert.ok(stripped.includes('b'));
      assert.ok(stripped.includes('c'));
      assert.ok(stripped.includes('d'));
    });
  });

  describe('alert-line edge cases', () => {
    it('uses ⚠ for critical and ⚡ for warning', () => {
      const result1 = renderAlertLine([{
        type: 'context-critical', message: 'test',
        actions: { visual: true, bell: false, predict: true },
      }]);
      const stripped1 = result1.replace(/\x1b\[[0-9;]*m/g, '');
      assert.ok(stripped1.includes('⚠'));

      const result2 = renderAlertLine([{
        type: 'context-warning', message: 'test',
        actions: { visual: true, bell: false, predict: true },
      }]);
      const stripped2 = result2.replace(/\x1b\[[0-9;]*m/g, '');
      assert.ok(stripped2.includes('⚡'));
    });
  });
});
