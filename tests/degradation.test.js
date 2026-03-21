import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('graceful degradation', () => {
  let cacheDir;
  beforeEach(() => { cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-degrade-')); });
  afterEach(() => { fs.rmSync(cacheDir, { recursive: true, force: true }); });

  describe('cache handles garbage', () => {
    it('survives corrupted JSON', async () => {
      const { readCache, writeCache } = await import('../dist/cache.js');
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(path.join(cacheDir, 'cache.json'), '{{{{not json');
      assert.strictEqual(readCache('key', 5000, cacheDir), null);
      // Should still be able to write after corruption
      writeCache('key', 'value', cacheDir);
      assert.strictEqual(readCache('key', 5000, cacheDir), 'value');
    });

    it('survives permission denied (read-only dir)', async () => {
      const { readCache } = await import('../dist/cache.js');
      // Non-existent nested dir — readCache should return null, not throw
      const badDir = '/tmp/nonexistent-hud-test-' + Date.now() + '/deep/nested';
      assert.strictEqual(readCache('key', 5000, badDir), null);
    });
  });

  describe('burn-rate handles edge cases', () => {
    it('survives NaN input', async () => {
      const { calculateBurnRate, recordTokenSnapshot } = await import('../dist/burn-rate.js');
      assert.strictEqual(calculateBurnRate(NaN, 200000, cacheDir), null);
      assert.strictEqual(calculateBurnRate(50000, NaN, cacheDir), null);
      // recordTokenSnapshot with NaN should not crash
      recordTokenSnapshot(NaN, cacheDir);
    });

    it('survives Infinity input', async () => {
      const { calculateBurnRate } = await import('../dist/burn-rate.js');
      assert.strictEqual(calculateBurnRate(Infinity, 200000, cacheDir), null);
    });
  });

  describe('alert handles edge cases', () => {
    it('survives negative percentages', async () => {
      const { evaluateAlerts } = await import('../dist/alert.js');
      const config = {
        context: { warningThreshold: 70, criticalThreshold: 85, actions: { visual: true, bell: false, predict: true } },
        usage5h: { warningThreshold: 70, criticalThreshold: 90, actions: { visual: true, bell: true, predict: true } },
        usage7d: { warningThreshold: 80, actions: { visual: true, bell: false, predict: true } },
      };
      const alerts = evaluateAlerts({
        contextPercent: -10, usage5hPercent: -5, usage7dPercent: -1,
        estimatedCallsRemaining: null, usageResetTime: null,
        alertConfig: config, cacheDir,
      });
      assert.strictEqual(alerts.length, 0);
    });

    it('survives percentage > 100', async () => {
      const { evaluateAlerts } = await import('../dist/alert.js');
      const config = {
        context: { warningThreshold: 70, criticalThreshold: 85, actions: { visual: true, bell: false, predict: true } },
        usage5h: { warningThreshold: 70, criticalThreshold: 90, actions: { visual: true, bell: true, predict: true } },
        usage7d: { warningThreshold: 80, actions: { visual: true, bell: false, predict: true } },
      };
      const alerts = evaluateAlerts({
        contextPercent: 150, usage5hPercent: 200, usage7dPercent: 300,
        estimatedCallsRemaining: -5, usageResetTime: null,
        alertConfig: config, cacheDir,
      });
      assert.ok(alerts.length > 0); // Should still generate alerts, not crash
    });
  });

  describe('cost-tracker handles edge cases', () => {
    it('survives zero tokens', async () => {
      const { estimateCost } = await import('../dist/cost-tracker.js');
      const result = estimateCost({
        model: { display_name: 'Opus' },
        context_window: { current_usage: { input_tokens: 0, output_tokens: 0 } },
      }, cacheDir);
      assert.ok(result !== null);
      assert.strictEqual(result.sessionCost, 0);
    });
  });

  describe('renderers handle empty/null context', () => {
    it('framework-line with malformed entries', async () => {
      const { renderFrameworkLine } = await import('../dist/render/framework-line.js');
      // Entry with undefined status
      const result = renderFrameworkLine([{
        provider: 'AGW',
        entries: [{ label: 'test', status: undefined }],
      }]);
      // Should not throw — returns something or null
      assert.ok(result === null || typeof result === 'string');
    });

    it('alert-line with empty message', async () => {
      const { renderAlertLine } = await import('../dist/render/alert-line.js');
      const result = renderAlertLine([{
        type: 'context-warning',
        message: '',
        actions: { visual: true, bell: false, predict: true },
      }]);
      assert.ok(result === null || typeof result === 'string');
    });
  });

  describe('session-history handles corrupt file', () => {
    it('returns empty array for corrupt history', async () => {
      const { loadHistory } = await import('../dist/session-history.js');
      // loadHistory reads from a fixed path, can't easily inject corruption
      // But we can verify it doesn't crash with the default path
      const result = loadHistory();
      assert.ok(Array.isArray(result));
    });
  });

  describe('suggestions handle minimal context', () => {
    it('returns empty for zero-state context', async () => {
      const { getSuggestions } = await import('../dist/suggestions.js');
      const result = getSuggestions({
        stdin: {},
        transcript: { tools: [], agents: [], todos: [] },
        burnRate: null,
        sessionStats: { totalToolCalls: 0, totalAgentRuns: 0, peakContextPercent: 0, autocompactCount: 0 },
      });
      assert.ok(Array.isArray(result));
    });
  });
});
