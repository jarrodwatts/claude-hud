import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('full integration', () => {
  let cacheDir;
  beforeEach(() => { cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-integration-')); });
  afterEach(() => { fs.rmSync(cacheDir, { recursive: true, force: true }); });

  it('main() produces output with full config', async () => {
    const { main } = await import('../dist/index.js');
    const { mergeConfig } = await import('../dist/config.js');

    const output = [];
    const config = mergeConfig({
      display: {
        showTools: true,
        showAgents: true,
        showTodos: true,
        showDuration: true,
        showFrameworks: false, // avoid network
        showBurnRate: true,
        showAlerts: true,
        activityIndicator: true,
        treePrefixes: true,
        showCost: true,
        barStyle: 'modern',
      },
    });

    await main({
      readStdin: async () => ({
        model: { display_name: 'Opus 4.6' },
        context_window: {
          context_window_size: 200000,
          current_usage: { input_tokens: 90000, output_tokens: 5000 },
        },
      }),
      parseTranscript: async () => ({
        tools: [
          { id: '1', name: 'Read', status: 'completed', startTime: new Date(), target: 'file.ts' },
          { id: '2', name: 'Edit', status: 'running', startTime: new Date(), target: 'index.ts' },
        ],
        agents: [],
        todos: [
          { content: 'Fix bug', status: 'completed' },
          { content: 'Add tests', status: 'in_progress' },
          { content: 'Deploy', status: 'pending' },
        ],
        sessionStart: new Date(Date.now() - 3600000),
      }),
      countConfigs: async () => ({ claudeMdCount: 1, rulesCount: 2, mcpCount: 3, hooksCount: 1 }),
      getGitStatus: async () => ({ branch: 'main', isDirty: true, ahead: 2, behind: 0, stashCount: 1, state: 'normal' }),
      getUsage: async () => null,
      loadConfig: async () => config,
      parseExtraCmdArg: () => null,
      runExtraCmd: async () => null,
      render: (ctx) => {
        // Capture rendered output by calling render functions directly
        output.push('rendered');
      },
      now: () => Date.now(),
      log: () => {},
    });

    assert.ok(output.length > 0, 'should have rendered');
  });

  it('cache layer survives rapid invocations', async () => {
    const { readCache, writeCache } = await import('../dist/cache.js');

    // Simulate 10 rapid invocations
    for (let i = 0; i < 10; i++) {
      writeCache(`key-${i}`, `value-${i}`, cacheDir);
    }

    // All should be readable
    for (let i = 0; i < 10; i++) {
      assert.strictEqual(readCache(`key-${i}`, 5000, cacheDir), `value-${i}`);
    }
  });

  it('all modules export expected functions', async () => {
    const cache = await import('../dist/cache.js');
    assert.ok(typeof cache.readCache === 'function');
    assert.ok(typeof cache.writeCache === 'function');

    const burnRate = await import('../dist/burn-rate.js');
    assert.ok(typeof burnRate.calculateBurnRate === 'function');
    assert.ok(typeof burnRate.recordTokenSnapshot === 'function');

    const sessionStats = await import('../dist/session-stats.js');
    assert.ok(typeof sessionStats.getSessionStats === 'function');
    assert.ok(typeof sessionStats.updateSessionStats === 'function');
    assert.ok(typeof sessionStats.getSparkline === 'function');

    const alert = await import('../dist/alert.js');
    assert.ok(typeof alert.evaluateAlerts === 'function');
    assert.ok(typeof alert.shouldBell === 'function');
    assert.ok(typeof alert.predictRateLimitHit === 'function');

    const cost = await import('../dist/cost-tracker.js');
    assert.ok(typeof cost.estimateCost === 'function');
    assert.ok(typeof cost.formatCost === 'function');
    assert.ok(typeof cost.predictSessionCost === 'function');

    const themes = await import('../dist/themes.js');
    assert.ok(typeof themes.getTheme === 'function');
    assert.ok(typeof themes.getThemeNames === 'function');
    assert.ok(typeof themes.detectTerminalTheme === 'function');

    const i18n = await import('../dist/i18n.js');
    assert.ok(typeof i18n.getLabels === 'function');
    assert.ok(typeof i18n.detectLocale === 'function');

    const suggestions = await import('../dist/suggestions.js');
    assert.ok(typeof suggestions.getSuggestions === 'function');

    const perfGuard = await import('../dist/perf-guard.js');
    assert.ok(typeof perfGuard.shouldDegrade === 'function');
    assert.ok(typeof perfGuard.recordExecutionTime === 'function');

    const presets = await import('../dist/presets.js');
    assert.ok(typeof presets.loadPresets === 'function');
    assert.ok(typeof presets.savePreset === 'function');

    const configIo = await import('../dist/config-io.js');
    assert.ok(typeof configIo.exportConfig === 'function');
    assert.ok(typeof configIo.importConfig === 'function');

    const healthCheck = await import('../dist/health-check.js');
    assert.ok(typeof healthCheck.runHealthCheck === 'function');

    const sessionHistory = await import('../dist/session-history.js');
    assert.ok(typeof sessionHistory.loadHistory === 'function');
    assert.ok(typeof sessionHistory.generateWeeklySummary === 'function');
    assert.ok(typeof sessionHistory.tagCurrentSession === 'function');

    const sessionLock = await import('../dist/session-lock.js');
    assert.ok(typeof sessionLock.registerSession === 'function');
    assert.ok(typeof sessionLock.getSessionCount === 'function');
  });

  it('themes all have valid color values', async () => {
    const { THEMES } = await import('../dist/themes.js');
    for (const [name, theme] of Object.entries(THEMES)) {
      assert.ok(theme.colors.context, `${name} missing context color`);
      assert.ok(theme.colors.usage, `${name} missing usage color`);
      assert.ok(theme.colors.warning, `${name} missing warning color`);
      assert.ok(theme.colors.critical, `${name} missing critical color`);
    }
  });

  it('i18n has all labels for all locales', async () => {
    const { getLabels } = await import('../dist/i18n.js');
    for (const locale of ['en', 'zh', 'ja']) {
      const labels = getLabels(locale);
      assert.ok(labels.context, `${locale} missing context`);
      assert.ok(labels.usage, `${locale} missing usage`);
      assert.ok(labels.tools, `${locale} missing tools`);
      assert.ok(labels.todos, `${locale} missing todos`);
      assert.ok(labels.resetsIn !== undefined, `${locale} missing resetsIn`);
      assert.ok(labels.err !== undefined, `${locale} missing err`);
    }
  });
});
