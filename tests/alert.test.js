import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { evaluateAlerts, shouldBell } from '../dist/alert.js';

describe('alert engine', () => {
  let cacheDir;
  beforeEach(() => { cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-alert-test-')); });
  afterEach(() => { fs.rmSync(cacheDir, { recursive: true, force: true }); });

  const defaultAlertConfig = {
    context: { warningThreshold: 70, criticalThreshold: 85, actions: { visual: true, bell: false, predict: true } },
    usage5h: { warningThreshold: 70, criticalThreshold: 90, actions: { visual: true, bell: true, predict: true } },
    usage7d: { warningThreshold: 80, actions: { visual: true, bell: false, predict: true } },
  };

  it('returns empty array when below thresholds', () => {
    const alerts = evaluateAlerts({ contextPercent: 50, usage5hPercent: 30, usage7dPercent: 40, estimatedCallsRemaining: null, usageResetTime: null, alertConfig: defaultAlertConfig, cacheDir });
    assert.strictEqual(alerts.length, 0);
  });

  it('returns context-warning when context >= 70%', () => {
    const alerts = evaluateAlerts({ contextPercent: 72, usage5hPercent: 30, usage7dPercent: 40, estimatedCallsRemaining: 25, usageResetTime: null, alertConfig: defaultAlertConfig, cacheDir });
    assert.strictEqual(alerts.length, 1);
    assert.strictEqual(alerts[0].type, 'context-warning');
    assert.ok(alerts[0].message.includes('25'));
  });

  it('returns context-critical over warning when >= 85%', () => {
    const alerts = evaluateAlerts({ contextPercent: 92, usage5hPercent: 30, usage7dPercent: 40, estimatedCallsRemaining: 8, usageResetTime: null, alertConfig: defaultAlertConfig, cacheDir });
    assert.strictEqual(alerts.length, 1);
    assert.strictEqual(alerts[0].type, 'context-critical');
  });

  it('returns multiple alerts', () => {
    const alerts = evaluateAlerts({ contextPercent: 90, usage5hPercent: 92, usage7dPercent: 40, estimatedCallsRemaining: 8, usageResetTime: '14:32', alertConfig: defaultAlertConfig, cacheDir });
    assert.strictEqual(alerts.length, 2);
    assert.ok(alerts.map(a => a.type).includes('context-critical'));
    assert.ok(alerts.map(a => a.type).includes('usage-5h-critical'));
  });

  it('bell fires only once per level transition', () => {
    const input = { contextPercent: 90, usage5hPercent: 30, usage7dPercent: 40, estimatedCallsRemaining: 8, usageResetTime: null, alertConfig: defaultAlertConfig, cacheDir };
    const alerts1 = evaluateAlerts(input);
    assert.strictEqual(shouldBell(alerts1, cacheDir), false); // context bell=false
    input.usage5hPercent = 95;
    const alerts3 = evaluateAlerts(input);
    assert.strictEqual(shouldBell(alerts3, cacheDir), true); // first trigger
    const alerts4 = evaluateAlerts(input);
    assert.strictEqual(shouldBell(alerts4, cacheDir), false); // already fired
  });
});
