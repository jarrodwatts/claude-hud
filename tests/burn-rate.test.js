import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { calculateBurnRate, recordTokenSnapshot } from '../dist/burn-rate.js';

describe('burn-rate', () => {
  let cacheDir;
  beforeEach(() => { cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-burn-test-')); });
  afterEach(() => { fs.rmSync(cacheDir, { recursive: true, force: true }); });

  it('returns null on cold start', () => {
    assert.strictEqual(calculateBurnRate(50000, 200000, cacheDir), null);
  });

  it('returns null before 60s of data', () => {
    recordTokenSnapshot(40000, cacheDir, Date.now() - 30000);
    assert.strictEqual(calculateBurnRate(50000, 200000, cacheDir), null);
  });

  it('calculates burn rate after sufficient data', () => {
    const now = Date.now();
    recordTokenSnapshot(40000, cacheDir, now - 120000);
    recordTokenSnapshot(45000, cacheDir, now - 60000);
    recordTokenSnapshot(50000, cacheDir, now);
    const result = calculateBurnRate(50000, 200000, cacheDir);
    assert.ok(result !== null);
    assert.ok(result.tokensPerMinute > 0);
    assert.ok(result.estimatedCallsRemaining > 0);
  });
});
