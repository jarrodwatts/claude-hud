import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { DEFAULT_CONFIG, mergeConfig } from '../dist/config.js';
import {
  CLI_USAGE_MAX_AGE_MS,
  CLI_USAGE_REFRESH_MS,
  CLI_USAGE_REFRESH_HOLDOFF_MS,
  getScopedUsageFromCliCache,
  readCliUsageCache,
} from '../dist/cli-usage.js';
import { main } from '../dist/index.js';
import { setLanguage } from '../dist/i18n/index.js';

setLanguage('en');

const HOME = '/home/hud-test';
const NOW = 1_800_000_000_000;

// Mirrors the `cachedUsageUtilization` block Claude Code persists in
// {CLAUDE_CONFIG_DIR}.json after a /usage fetch. Only the fields this
// feeder consumes are modeled; extra fields must be ignored.
function claudeJson({ fetchedAtMs = NOW, limits, extra = {} } = {}) {
  return JSON.stringify({
    someUnrelatedKey: true,
    cachedUsageUtilization: {
      fetchedAtMs,
      accountUuid: 'account-1',
      utilization: {
        five_hour: { utilization: 5 },
        limits: limits ?? [
          {
            kind: 'session',
            percent: 5,
            resets_at: '2026-08-20T05:49:59+00:00',
            scope: null,
          },
          {
            kind: 'weekly_all',
            percent: 20,
            resets_at: '2026-08-25T05:59:59+00:00',
            scope: null,
          },
          {
            kind: 'weekly_scoped',
            percent: 36,
            resets_at: '2026-08-25T06:00:00+00:00',
            scope: { model: { id: null, display_name: 'Fable' }, surface: null },
          },
        ],
      },
      ...extra,
    },
  });
}

function makeDeps({ file, markerAgeMs = null } = {}) {
  const spawned = [];
  const markerWrites = [];
  let markerMtime = markerAgeMs != null ? NOW - markerAgeMs : null;
  const configJsonPath = path.join(HOME, '.claude.json');
  return {
    spawned,
    markerWrites,
    deps: {
      homeDir: () => HOME,
      readFileSync: (filePath) => {
        if (filePath !== configJsonPath) {
          throw new Error(`ENOENT: ${filePath}`);
        }
        if (file == null) {
          throw new Error('ENOENT');
        }
        return file;
      },
      statSync: (filePath) => {
        if (markerMtime == null || !filePath.endsWith('cli-usage-refresh.marker')) {
          throw new Error('ENOENT');
        }
        return { mtimeMs: markerMtime };
      },
      mkdirSync: () => {},
      writeFileSync: (filePath) => {
        markerWrites.push(filePath);
      },
      utimesSync: (_filePath, _atime, mtime) => {
        markerMtime = mtime.getTime();
      },
      spawn: (command, args, options) => {
        spawned.push({ command, args, options });
        return { unref: () => {}, on: () => {} };
      },
    },
  };
}

function makeConfig(displayOverrides = {}) {
  return {
    ...DEFAULT_CONFIG,
    display: {
      ...DEFAULT_CONFIG.display,
      refreshModelScopedUsage: true,
      ...displayOverrides,
    },
  };
}

// --- readCliUsageCache -------------------------------------------------

test('readCliUsageCache projects model-scoped limits and skips generic windows', () => {
  const { deps } = makeDeps({ file: claudeJson() });
  const cache = readCliUsageCache(deps);
  assert.equal(cache.fetchedAtMs, NOW);
  assert.equal(cache.scopedWindows.length, 1);
  assert.equal(cache.scopedWindows[0].label, 'Fable');
  assert.equal(cache.scopedWindows[0].percent, 36);
  assert.ok(cache.scopedWindows[0].resetAt instanceof Date);
});

test('readCliUsageCache keeps every model-scoped window, not just one model', () => {
  const { deps } = makeDeps({
    file: claudeJson({
      limits: [
        { kind: 'weekly_scoped', percent: 36, resets_at: null, scope: { model: { display_name: 'Fable' } } },
        { kind: 'weekly_scoped', percent: 12, resets_at: null, scope: { model: { display_name: 'Some Future Model' } } },
      ],
    }),
  });
  const cache = readCliUsageCache(deps);
  assert.deepEqual(
    cache.scopedWindows.map((window) => [window.label, window.percent]),
    [['Fable', 36], ['Some Future Model', 12]],
  );
});

test('readCliUsageCache drops entries without a model display name', () => {
  const { deps } = makeDeps({
    file: claudeJson({
      limits: [
        { kind: 'weekly_scoped', percent: 36, scope: { model: { display_name: '' } } },
        { kind: 'weekly_scoped', percent: 36, scope: { model: {} } },
        { kind: 'weekly_scoped', percent: 36, scope: {} },
        { kind: 'weekly_scoped', percent: 36, scope: null },
        null,
      ],
    }),
  });
  assert.deepEqual(readCliUsageCache(deps).scopedWindows, []);
});

test('readCliUsageCache preserves null percent and drops invalid reset strings', () => {
  const { deps } = makeDeps({
    file: claudeJson({
      limits: [
        { kind: 'weekly_scoped', percent: null, resets_at: 'not-a-date', scope: { model: { display_name: 'Fable' } } },
      ],
    }),
  });
  const [window] = readCliUsageCache(deps).scopedWindows;
  assert.equal(window.percent, null);
  assert.equal(window.resetAt, null);
});

test('readCliUsageCache returns null for missing file, missing cache, or bad timestamp', () => {
  assert.equal(readCliUsageCache(makeDeps({ file: null }).deps), null);
  assert.equal(readCliUsageCache(makeDeps({ file: '{"otherKey":1}' }).deps), null);
  assert.equal(readCliUsageCache(makeDeps({ file: 'not json' }).deps), null);
  assert.equal(
    readCliUsageCache(makeDeps({ file: claudeJson({ fetchedAtMs: 'soon' }) }).deps),
    null,
  );
  assert.equal(
    readCliUsageCache(makeDeps({ file: claudeJson({ fetchedAtMs: -5 }) }).deps),
    null,
  );
});

// --- getScopedUsageFromCliCache: freshness and refresh ------------------

test('fresh cache returns windows without spawning a refresh', () => {
  const { deps, spawned } = makeDeps({ file: claudeJson({ fetchedAtMs: NOW - 60_000 }) });
  const windows = getScopedUsageFromCliCache(NOW, true, deps);
  assert.equal(windows.length, 1);
  assert.equal(spawned.length, 0);
});

test('stale-but-usable cache returns windows and schedules one refresh', () => {
  const { deps, spawned } = makeDeps({
    file: claudeJson({ fetchedAtMs: NOW - CLI_USAGE_REFRESH_MS - 1 }),
  });
  const windows = getScopedUsageFromCliCache(NOW, true, deps);
  assert.equal(windows.length, 1);
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].command, 'claude');
  assert.deepEqual(spawned[0].args, ['-p', '/usage']);
  assert.deepEqual(spawned[0].options, { detached: true, stdio: 'ignore' });
});

test('cache older than the CLI trusts is not rendered but still triggers a refresh', () => {
  const { deps, spawned } = makeDeps({
    file: claudeJson({ fetchedAtMs: NOW - CLI_USAGE_MAX_AGE_MS - 1 }),
  });
  assert.equal(getScopedUsageFromCliCache(NOW, true, deps), null);
  assert.equal(spawned.length, 1);
});

test('cache from the future is rejected and a refresh is scheduled', () => {
  const { deps, spawned } = makeDeps({ file: claudeJson({ fetchedAtMs: NOW + 60_000 }) });
  assert.equal(getScopedUsageFromCliCache(NOW, true, deps), null);
  assert.equal(spawned.length, 1);
});

test('missing cache schedules a refresh so the first render primes it', () => {
  const { deps, spawned } = makeDeps({ file: null });
  assert.equal(getScopedUsageFromCliCache(NOW, true, deps), null);
  assert.equal(spawned.length, 1);
});

test('cache without any scoped window returns null and stays quiet while fresh', () => {
  const { deps, spawned } = makeDeps({
    file: claudeJson({ limits: [{ kind: 'session', percent: 5, scope: null }] }),
  });
  assert.equal(getScopedUsageFromCliCache(NOW, true, deps), null);
  assert.equal(spawned.length, 0);
});

test('a recent refresh marker suppresses duplicate spawns across renders', () => {
  const { deps, spawned } = makeDeps({
    file: claudeJson({ fetchedAtMs: NOW - CLI_USAGE_MAX_AGE_MS - 1 }),
    markerAgeMs: CLI_USAGE_REFRESH_HOLDOFF_MS - 1,
  });
  getScopedUsageFromCliCache(NOW, true, deps);
  assert.equal(spawned.length, 0);
});

test('an expired refresh marker allows a retry', () => {
  const { deps, spawned } = makeDeps({
    file: claudeJson({ fetchedAtMs: NOW - CLI_USAGE_MAX_AGE_MS - 1 }),
    markerAgeMs: CLI_USAGE_REFRESH_HOLDOFF_MS + 1,
  });
  getScopedUsageFromCliCache(NOW, true, deps);
  assert.equal(spawned.length, 1);
});

test('consecutive stale renders spawn only once thanks to the marker', () => {
  const { deps, spawned } = makeDeps({
    file: claudeJson({ fetchedAtMs: NOW - CLI_USAGE_MAX_AGE_MS - 1 }),
  });
  getScopedUsageFromCliCache(NOW, true, deps);
  getScopedUsageFromCliCache(NOW + 1_000, true, deps);
  assert.equal(spawned.length, 1);
});

test('reading works with refresh disabled: stale cache still renders, nothing spawns', () => {
  const { deps, spawned } = makeDeps({
    file: claudeJson({ fetchedAtMs: NOW - CLI_USAGE_REFRESH_MS - 1 }),
  });
  const windows = getScopedUsageFromCliCache(NOW, false, deps);
  assert.equal(windows.length, 1);
  assert.equal(spawned.length, 0);
});

test('spawn failures are swallowed and never break the render', () => {
  const { deps } = makeDeps({ file: claudeJson({ fetchedAtMs: NOW - CLI_USAGE_MAX_AGE_MS - 1 }) });
  deps.spawn = () => {
    throw new Error('spawn ENOENT');
  };
  assert.equal(getScopedUsageFromCliCache(NOW, true, deps), null);
});

// --- config parsing ------------------------------------------------------

test('mergeConfig keeps the feeder off by default and validates the opt-in', () => {
  assert.equal(mergeConfig({}).display.refreshModelScopedUsage, false);
  assert.equal(
    mergeConfig({ display: { refreshModelScopedUsage: true } }).display.refreshModelScopedUsage,
    true,
  );
  assert.equal(
    mergeConfig({ display: { refreshModelScopedUsage: 'yes' } }).display.refreshModelScopedUsage,
    false,
  );
});

// --- main() integration --------------------------------------------------

function mainDeps({ config, stdinRateLimits, cliWindows, extUsage, calls, ctxSink }) {
  return {
    readStdin: async () => ({
      cwd: '/tmp/project',
      model: { display_name: 'Opus' },
      context_window: { context_window_size: 100, current_usage: { input_tokens: 10 } },
      ...(stdinRateLimits !== undefined && { rate_limits: stdinRateLimits }),
    }),
    parseTranscript: async () => ({ tools: [], agents: [], todos: [] }),
    countConfigs: async () => ({ claudeMdCount: 0, rulesCount: 0, mcpCount: 0, hooksCount: 0 }),
    loadConfig: async () => config,
    getGitStatus: async () => null,
    isJjRepo: () => false,
    applyContextWindowFallback: () => {},
    getUsageFromExternalSnapshot: () => extUsage ?? null,
    getScopedUsageFromCliCache: (...args) => {
      calls.push(args);
      return cliWindows;
    },
    render: (ctx) => ctxSink.push(ctx),
    now: () => NOW,
    log: () => {},
  };
}

test('main backfills scopedWindows from the CLI cache and forwards the refresh flag', async () => {
  const calls = [];
  const ctxSink = [];
  const config = makeConfig();
  config.gitStatus = { ...config.gitStatus, enabled: false };
  await main(mainDeps({
    config,
    stdinRateLimits: { five_hour: { used_percentage: 12 } },
    cliWindows: [{ label: 'Fable', percent: 36, resetAt: null }],
    calls,
    ctxSink,
  }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], true);
  assert.equal(ctxSink[0].usageData.fiveHour, 12);
  assert.deepEqual(ctxSink[0].usageData.scopedWindows, [
    { label: 'Fable', percent: 36, resetAt: null },
  ]);
});

test('main builds usageData from the CLI cache alone when stdin has no rate limits', async () => {
  const calls = [];
  const ctxSink = [];
  const config = makeConfig();
  config.gitStatus = { ...config.gitStatus, enabled: false };
  await main(mainDeps({
    config,
    stdinRateLimits: undefined,
    cliWindows: [{ label: 'Fable', percent: 36, resetAt: null }],
    calls,
    ctxSink,
  }));
  assert.equal(ctxSink[0].usageData.fiveHour, null);
  assert.equal(ctxSink[0].usageData.scopedWindows.length, 1);
});

test('main lets stdin scoped windows win over the CLI cache', async () => {
  const calls = [];
  const ctxSink = [];
  const config = makeConfig();
  config.gitStatus = { ...config.gitStatus, enabled: false };
  await main(mainDeps({
    config,
    stdinRateLimits: {
      five_hour: { used_percentage: 12 },
      model_scoped: [{ display_name: 'Fable', utilization: 40, resets_at: null }],
    },
    cliWindows: [{ label: 'Stale', percent: 1, resetAt: null }],
    calls,
    ctxSink,
  }));
  assert.equal(calls.length, 0);
  assert.equal(ctxSink[0].usageData.scopedWindows[0].label, 'Fable');
  assert.equal(ctxSink[0].usageData.scopedWindows[0].percent, 40);
});

test('main still reads the CLI cache with refresh disabled, passing the flag through', async () => {
  const calls = [];
  const ctxSink = [];
  const config = makeConfig({ refreshModelScopedUsage: false });
  config.gitStatus = { ...config.gitStatus, enabled: false };
  await main(mainDeps({
    config,
    stdinRateLimits: { five_hour: { used_percentage: 12 } },
    cliWindows: [{ label: 'Fable', percent: 36, resetAt: null }],
    calls,
    ctxSink,
  }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], false);
  assert.deepEqual(ctxSink[0].usageData.scopedWindows, [
    { label: 'Fable', percent: 36, resetAt: null },
  ]);
});

test('main prefers the external snapshot over the CLI cache when refresh is off', async () => {
  const calls = [];
  const ctxSink = [];
  const config = makeConfig({ refreshModelScopedUsage: false, externalUsagePath: '/abs/snapshot.json' });
  config.gitStatus = { ...config.gitStatus, enabled: false };
  await main(mainDeps({
    config,
    stdinRateLimits: { five_hour: { used_percentage: 12 } },
    extUsage: {
      fiveHour: null,
      sevenDay: null,
      fiveHourResetAt: null,
      sevenDayResetAt: null,
      scopedWindows: [{ label: 'FromSnapshot', percent: 50, resetAt: null }],
    },
    cliWindows: [{ label: 'FromCliCache', percent: 36, resetAt: null }],
    calls,
    ctxSink,
  }));
  assert.equal(ctxSink[0].usageData.scopedWindows[0].label, 'FromSnapshot');
});

test('main promotes the CLI cache above the external snapshot when refresh is on', async () => {
  const calls = [];
  const ctxSink = [];
  const config = makeConfig({ externalUsagePath: '/abs/snapshot.json' });
  config.gitStatus = { ...config.gitStatus, enabled: false };
  await main(mainDeps({
    config,
    stdinRateLimits: { five_hour: { used_percentage: 12 } },
    extUsage: {
      fiveHour: null,
      sevenDay: null,
      fiveHourResetAt: null,
      sevenDayResetAt: null,
      scopedWindows: [{ label: 'FromSnapshot', percent: 50, resetAt: null }],
    },
    cliWindows: [{ label: 'FromCliCache', percent: 36, resetAt: null }],
    calls,
    ctxSink,
  }));
  assert.equal(ctxSink[0].usageData.scopedWindows[0].label, 'FromCliCache');
});

test('main keeps the external snapshot when refresh is on but the CLI cache is empty', async () => {
  const calls = [];
  const ctxSink = [];
  const config = makeConfig({ externalUsagePath: '/abs/snapshot.json' });
  config.gitStatus = { ...config.gitStatus, enabled: false };
  await main(mainDeps({
    config,
    stdinRateLimits: { five_hour: { used_percentage: 12 } },
    extUsage: {
      fiveHour: null,
      sevenDay: null,
      fiveHourResetAt: null,
      sevenDayResetAt: null,
      scopedWindows: [{ label: 'FromSnapshot', percent: 50, resetAt: null }],
    },
    cliWindows: null,
    calls,
    ctxSink,
  }));
  assert.equal(ctxSink[0].usageData.scopedWindows[0].label, 'FromSnapshot');
});
