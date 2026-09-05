import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG } from "../dist/config.js";
import { setLanguage } from "../dist/i18n/index.js";
import { formatSessionDuration, main, resolveVcsStatus } from "../dist/index.js";

function restoreEnvVar(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

function makeConfig(overrides = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
    gitStatus: {
      ...DEFAULT_CONFIG.gitStatus,
      ...(overrides.gitStatus ?? {}),
    },
    jjStatus: {
      ...DEFAULT_CONFIG.jjStatus,
      ...(overrides.jjStatus ?? {}),
    },
    display: {
      ...DEFAULT_CONFIG.display,
      ...(overrides.display ?? {}),
    },
    colors: {
      ...DEFAULT_CONFIG.colors,
      ...(overrides.colors ?? {}),
    },
  };
}

function makeStdin(overrides = {}) {
  const contextWindowOverrides = overrides.context_window ?? {};
  const currentUsageOverrides = contextWindowOverrides.current_usage ?? {};

  return {
    cwd: "/tmp/project",
    model: {
      display_name: "Opus",
      ...(overrides.model ?? {}),
    },
    context_window: {
      context_window_size: 100,
      current_usage: {
        input_tokens: 10,
        ...currentUsageOverrides,
      },
      ...contextWindowOverrides,
    },
    ...overrides,
  };
}

function makeTranscript(overrides = {}) {
  return {
    tools: [],
    agents: [],
    todos: [],
    ...overrides,
  };
}

function makeCounts(overrides = {}) {
  return {
    claudeMdCount: 0,
    rulesCount: 0,
    mcpCount: 0,
    hooksCount: 0,
    ...overrides,
  };
}

async function createTempConfigDir(config = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "claude-hud-index-test-"));
  const pluginDir = path.join(dir, "plugins", "claude-hud");
  await mkdir(pluginDir, { recursive: true });
  await writeFile(
    path.join(pluginDir, "config.json"),
    JSON.stringify(config),
    "utf8",
  );
  return {
    dir,
    cleanup: async () => rm(dir, { recursive: true, force: true }),
  };
}

setLanguage("en");

test("formatSessionDuration returns empty string without session start", () => {
  assert.equal(formatSessionDuration(undefined, () => 0), "");
});

test("formatSessionDuration formats sub-minute and minute durations", () => {
  const start = new Date(0);
  assert.equal(formatSessionDuration(start, () => 30 * 1000), "<1m");
  assert.equal(formatSessionDuration(start, () => 5 * 60 * 1000), "5m");
});

test("formatSessionDuration formats hour durations", () => {
  const start = new Date(0);
  assert.equal(
    formatSessionDuration(start, () => 2 * 60 * 60 * 1000 + 5 * 60 * 1000),
    "2h 5m",
  );
});

test("formatSessionDuration uses Date.now by default", () => {
  const originalNow = Date.now;
  Date.now = () => 60_000;
  try {
    assert.equal(formatSessionDuration(new Date(0)), "1m");
  } finally {
    Date.now = originalNow;
  }
});

test("main logs an error when dependencies throw", async () => {
  const logs = [];

  await main({
    readStdin: async () => {
      throw new Error("boom");
    },
    log: (...args) => logs.push(args.join(" ")),
  });

  assert.ok(logs.some((line) => line.includes("[claude-hud] Error:")));
});

test("main logs unknown error for non-Error throws", async () => {
  const logs = [];

  await main({
    readStdin: async () => {
      throw "boom";
    },
    log: (...args) => logs.push(args.join(" ")),
  });

  assert.ok(logs.some((line) => line.includes("Unknown error")));
});

test("index entrypoint runs when executed directly", async () => {
  const originalArgv = [...process.argv];
  const originalIsTTY = process.stdin.isTTY;
  const originalLog = console.log;
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
  const logs = [];
  const { dir, cleanup } = await createTempConfigDir({ language: "en" });

  try {
    process.env.CLAUDE_CONFIG_DIR = dir;
    setLanguage("en");
    const moduleUrl = new URL("../dist/index.js", import.meta.url);
    process.argv[1] = fileURLToPath(moduleUrl);
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });
    console.log = (...args) => logs.push(args.join(" "));
    await import(`${moduleUrl}?entry=${Date.now()}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  } finally {
    console.log = originalLog;
    process.argv = originalArgv;
    restoreEnvVar("CLAUDE_CONFIG_DIR", originalConfigDir);
    Object.defineProperty(process.stdin, "isTTY", {
      value: originalIsTTY,
      configurable: true,
    });
    await cleanup();
  }

  assert.ok(logs.some((line) => line.includes("[claude-hud] Initializing...")));
});

test("main executes the happy path", async () => {
  const originalNow = Date.now;
  let renderedContext;

  Date.now = () => 60_000;
  try {
    await main({
      readStdin: async () => makeStdin(),
      parseTranscript: async () => makeTranscript({ sessionStart: new Date(0) }),
      countConfigs: async () => makeCounts({ outputStyle: "tech-leader" }),
      loadConfig: async () => makeConfig(),
      getGitStatus: async () => null,
      render: (ctx) => {
        renderedContext = ctx;
      },
    });
  } finally {
    Date.now = originalNow;
  }

  assert.equal(renderedContext?.sessionDuration, "1m");
  assert.equal(renderedContext?.outputStyle, "tech-leader");
});

test("main passes compact transcript metadata to context fallback", async () => {
  const stdin = makeStdin({ transcript_path: "/tmp/session.jsonl" });
  const boundary = new Date("2026-04-24T03:00:00.000Z");
  let fallbackArgs;

  await main({
    readStdin: async () => stdin,
    parseTranscript: async (transcriptPath) => {
      assert.equal(transcriptPath, "/tmp/session.jsonl");
      return makeTranscript({
        sessionName: "compact-session",
        lastCompactBoundaryAt: boundary,
        lastCompactPostTokens: 7679,
      });
    },
    applyContextWindowFallback: (...args) => {
      fallbackArgs = args;
    },
    countConfigs: async () => makeCounts(),
    loadConfig: async () => makeConfig(),
    getGitStatus: async () => null,
    render: () => {},
  });

  assert.equal(fallbackArgs?.[0], stdin);
  assert.deepEqual(fallbackArgs?.[1], {});
  assert.equal(fallbackArgs?.[2], "compact-session");
  assert.deepEqual(fallbackArgs?.[3], {
    lastCompactBoundaryAt: boundary,
    lastCompactPostTokens: 7679,
  });
});

test("main includes git status in render context", async () => {
  let renderedContext;

  await main({
    readStdin: async () => makeStdin({ cwd: "/some/path" }),
    parseTranscript: async () => makeTranscript(),
    countConfigs: async () => makeCounts(),
    loadConfig: async () => makeConfig(),
    getGitStatus: async () => ({
      branch: "feature/test",
      isDirty: false,
      ahead: 0,
      behind: 0,
      modifiedCount: 0,
      addedCount: 0,
      deletedCount: 0,
      untrackedCount: 0,
    }),
    render: (ctx) => {
      renderedContext = ctx;
    },
  });

  assert.equal(renderedContext?.gitStatus?.branch, "feature/test");
});

test("resolveVcsStatus returns null without a cwd", async () => {
  const result = await resolveVcsStatus(
    {
      getGitStatus: async () => { throw new Error("should not be called"); },
      getJjStatus: async () => { throw new Error("should not be called"); },
      isJjRepo: () => { throw new Error("should not be called"); },
    },
    makeConfig(),
    undefined,
  );
  assert.equal(result, null);
});

test("resolveVcsStatus prefers jj over git and never calls getGitStatus", async () => {
  let gitCalled = false;

  const result = await resolveVcsStatus(
    {
      getGitStatus: async () => {
        gitCalled = true;
        return null;
      },
      getJjStatus: async (cwd) => ({
        branch: "mybookmark",
        isDirty: false,
        ahead: 0,
        behind: 0,
        vcs: "jj",
        conflict: false,
      }),
      isJjRepo: () => true,
    },
    makeConfig({ jjStatus: { enabled: true } }),
    "/some/jj/repo",
  );

  assert.equal(gitCalled, false);
  assert.equal(result?.vcs, "jj");
  assert.equal(result?.branch, "mybookmark");
});

test("resolveVcsStatus falls back to git when the jj probe returns null", async () => {
  let gitCalled = false;

  const result = await resolveVcsStatus(
    {
      getGitStatus: async () => {
        gitCalled = true;
        return { branch: "main", isDirty: false, ahead: 0, behind: 0 };
      },
      getJjStatus: async () => null,
      isJjRepo: () => true,
    },
    makeConfig({ jjStatus: { enabled: true } }),
    "/some/colocated/repo",
  );

  assert.equal(gitCalled, true);
  assert.equal(result?.branch, "main");
  assert.equal(result?.vcs, undefined);
});

test("resolveVcsStatus does not fall back to git when git status is disabled", async () => {
  let gitCalled = false;

  const result = await resolveVcsStatus(
    {
      getGitStatus: async () => {
        gitCalled = true;
        return { branch: "main", isDirty: false, ahead: 0, behind: 0 };
      },
      getJjStatus: async () => null,
      isJjRepo: () => true,
    },
    makeConfig({
      jjStatus: { enabled: true },
      gitStatus: { enabled: false },
    }),
    "/some/jj/repo",
  );

  assert.equal(gitCalled, false);
  assert.equal(result, null);
});

test("resolveVcsStatus falls back to git when isJjRepo is false", async () => {
  let jjCalled = false;

  const result = await resolveVcsStatus(
    {
      getGitStatus: async () => ({
        branch: "main",
        isDirty: false,
        ahead: 0,
        behind: 0,
      }),
      getJjStatus: async () => {
        jjCalled = true;
        return null;
      },
      isJjRepo: () => false,
    },
    makeConfig(),
    "/some/git/repo",
  );

  assert.equal(jjCalled, false);
  assert.equal(result?.branch, "main");
});

test("resolveVcsStatus skips jj entirely when jjStatus.enabled is false", async () => {
  let jjCalled = false;

  const result = await resolveVcsStatus(
    {
      getGitStatus: async () => ({ branch: "main", isDirty: false, ahead: 0, behind: 0 }),
      getJjStatus: async () => {
        jjCalled = true;
        return null;
      },
      isJjRepo: () => true,
    },
    makeConfig({ jjStatus: { enabled: false } }),
    "/some/repo",
  );

  assert.equal(jjCalled, false);
  assert.equal(result?.branch, "main");
});

test("resolveVcsStatus returns null when both git and jj are disabled", async () => {
  const result = await resolveVcsStatus(
    {
      getGitStatus: async () => { throw new Error("should not be called"); },
      getJjStatus: async () => { throw new Error("should not be called"); },
      isJjRepo: () => false,
    },
    makeConfig({ gitStatus: { enabled: false } }),
    "/some/repo",
  );

  assert.equal(result, null);
});

test("main includes usageData from stdin when available", async () => {
  let renderedContext;
  let externalCalls = 0;

  await main({
    readStdin: async () => makeStdin({
      rate_limits: {
        five_hour: { used_percentage: 49.6, resets_at: 1710000000 },
        seven_day: { used_percentage: 25.2, resets_at: 1710600000 },
      },
    }),
    parseTranscript: async () => makeTranscript(),
    countConfigs: async () => makeCounts(),
    loadConfig: async () => makeConfig(),
    getGitStatus: async () => null,
    getUsageFromExternalSnapshot: () => {
      externalCalls += 1;
      return null;
    },
    render: (ctx) => {
      renderedContext = ctx;
    },
  });

  assert.equal(externalCalls, 0);
  assert.deepEqual(renderedContext?.usageData, {
    fiveHour: 50,
    sevenDay: 25,
    fiveHourResetAt: new Date(1710000000 * 1000),
    sevenDayResetAt: new Date(1710600000 * 1000),
  });
});

test("main leaves usageData null when stdin rate limits are absent and external fallback is unavailable", async () => {
  let renderedContext;
  let externalCalls = 0;

  await main({
    readStdin: async () => makeStdin({ rate_limits: null }),
    parseTranscript: async () => makeTranscript(),
    countConfigs: async () => makeCounts(),
    loadConfig: async () => makeConfig(),
    getGitStatus: async () => null,
    getUsageFromExternalSnapshot: () => {
      externalCalls += 1;
      return null;
    },
    render: (ctx) => {
      renderedContext = ctx;
    },
  });

  assert.equal(externalCalls, 1);
  assert.equal(renderedContext?.usageData, null);
});

test("main uses external usage fallback when stdin rate limits are absent", async () => {
  let renderedContext;
  let externalCalls = 0;
  const externalUsage = {
    fiveHour: 42,
    sevenDay: 85,
    fiveHourResetAt: new Date("2026-04-20T15:00:00.000Z"),
    sevenDayResetAt: new Date("2026-04-27T12:00:00.000Z"),
  };

  await main({
    readStdin: async () => makeStdin({ rate_limits: null }),
    parseTranscript: async () => makeTranscript(),
    countConfigs: async () => makeCounts(),
    loadConfig: async () => makeConfig(),
    getGitStatus: async () => null,
    now: () => Date.UTC(2026, 3, 20, 12, 1, 0),
    getUsageFromExternalSnapshot: (config, now) => {
      externalCalls += 1;
      assert.equal(config.display.externalUsagePath, "");
      assert.equal(now, Date.UTC(2026, 3, 20, 12, 1, 0));
      return externalUsage;
    },
    render: (ctx) => {
      renderedContext = ctx;
    },
  });

  assert.equal(externalCalls, 1);
  assert.deepEqual(renderedContext?.usageData, externalUsage);
});

test("main prefers stdin usage over external usage fallback", async () => {
  let renderedContext;
  let externalCalls = 0;

  await main({
    readStdin: async () => makeStdin({
      rate_limits: {
        five_hour: { used_percentage: 21.9, resets_at: 1710000000 },
        seven_day: { used_percentage: 55.2, resets_at: 1710600000 },
      },
    }),
    parseTranscript: async () => makeTranscript(),
    countConfigs: async () => makeCounts(),
    loadConfig: async () => makeConfig(),
    getGitStatus: async () => null,
    getUsageFromExternalSnapshot: () => {
      externalCalls += 1;
      return {
        fiveHour: 99,
        sevenDay: 99,
        fiveHourResetAt: null,
        sevenDayResetAt: null,
      };
    },
    render: (ctx) => {
      renderedContext = ctx;
    },
  });

  assert.equal(externalCalls, 0);
  assert.deepEqual(renderedContext?.usageData, {
    fiveHour: 22,
    sevenDay: 55,
    fiveHourResetAt: new Date(1710000000 * 1000),
    sevenDayResetAt: new Date(1710600000 * 1000),
  });
});

test("main appends external balance label to stdin usage when snapshot path is configured", async () => {
  let renderedContext;
  let externalCalls = 0;

  await main({
    readStdin: async () => makeStdin({
      rate_limits: {
        five_hour: { used_percentage: 21.9, resets_at: 1710000000 },
        seven_day: { used_percentage: 55.2, resets_at: 1710600000 },
      },
    }),
    parseTranscript: async () => makeTranscript(),
    countConfigs: async () => makeCounts(),
    loadConfig: async () => makeConfig({
      display: { externalUsagePath: "/tmp/usage.json" },
    }),
    getGitStatus: async () => null,
    getUsageFromExternalSnapshot: () => {
      externalCalls += 1;
      return {
        fiveHour: 99,
        sevenDay: 99,
        fiveHourResetAt: null,
        sevenDayResetAt: null,
        balanceLabel: "$12.34 / $20.00",
      };
    },
    render: (ctx) => {
      renderedContext = ctx;
    },
  });

  assert.equal(externalCalls, 1);
  assert.deepEqual(renderedContext?.usageData, {
    fiveHour: 22,
    sevenDay: 55,
    fiveHourResetAt: new Date(1710000000 * 1000),
    sevenDayResetAt: new Date(1710600000 * 1000),
    balanceLabel: "$12.34 / $20.00",
  });
});

test("main fills missing seven-day usage from external snapshot", async () => {
  let renderedContext;
  let externalCalls = 0;

  await main({
    readStdin: async () => makeStdin({
      rate_limits: {
        five_hour: { used_percentage: 21.9, resets_at: 1710000000 },
      },
    }),
    parseTranscript: async () => makeTranscript(),
    countConfigs: async () => makeCounts(),
    loadConfig: async () => makeConfig({
      display: { externalUsagePath: "/tmp/usage.json" },
    }),
    getGitStatus: async () => null,
    getUsageFromExternalSnapshot: () => {
      externalCalls += 1;
      return {
        fiveHour: 99,
        sevenDay: 85,
        fiveHourResetAt: null,
        sevenDayResetAt: new Date("2026-04-27T12:00:00.000Z"),
        balanceLabel: "$12.34 / $20.00",
      };
    },
    render: (ctx) => {
      renderedContext = ctx;
    },
  });

  assert.equal(externalCalls, 1);
  assert.deepEqual(renderedContext?.usageData, {
    fiveHour: 22,
    sevenDay: 85,
    fiveHourResetAt: new Date(1710000000 * 1000),
    sevenDayResetAt: new Date("2026-04-27T12:00:00.000Z"),
    balanceLabel: "$12.34 / $20.00",
  });
});

test("main skips all usage loading when usage display is disabled", async () => {
  let renderedContext;
  let externalCalls = 0;
  let stdinCalls = 0;

  await main({
    readStdin: async () => makeStdin({ rate_limits: null }),
    parseTranscript: async () => makeTranscript(),
    countConfigs: async () => makeCounts(),
    loadConfig: async () => makeConfig({ display: { showUsage: false } }),
    getGitStatus: async () => null,
    getUsageFromStdin: () => {
      stdinCalls += 1;
      return null;
    },
    getUsageFromExternalSnapshot: () => {
      externalCalls += 1;
      return null;
    },
    render: (ctx) => {
      renderedContext = ctx;
    },
  });

  assert.equal(stdinCalls, 0);
  assert.equal(externalCalls, 0);
  assert.equal(renderedContext?.usageData, null);
});

test("main includes Claude Code version in render context only when enabled", async () => {
  let renderedContext;
  let lookupCalls = 0;

  await main({
    readStdin: async () => makeStdin(),
    parseTranscript: async () => makeTranscript(),
    countConfigs: async () => makeCounts(),
    loadConfig: async () => makeConfig({
      display: { showClaudeCodeVersion: true },
    }),
    getGitStatus: async () => null,
    getClaudeCodeVersion: async () => {
      lookupCalls += 1;
      return "2.1.81";
    },
    render: (ctx) => {
      renderedContext = ctx;
    },
  });

  assert.equal(lookupCalls, 1);
  assert.equal(renderedContext?.claudeCodeVersion, "2.1.81");
});

// Regression for the launcher-script case: when PATH's `claude` is a wrapper
// script rather than a symlink into versions/<ver>, every signal the on-disk
// cache in getClaudeCodeVersion() keys on (resolved path, mtime) belongs to the
// launcher, not to the binary it execs. The launcher is untouched by a Claude
// Code upgrade, so that cache stays valid and pins the first version it saw --
// modelled here by the lookup still reporting 2.1.258. The payload wins because
// it comes from the process doing the render.
test("main prefers the Claude Code version from stdin over the binary lookup", async () => {
  let renderedContext;
  let lookupCalls = 0;

  await main({
    readStdin: async () => makeStdin({ version: "2.1.261" }),
    parseTranscript: async () => makeTranscript(),
    countConfigs: async () => makeCounts(),
    loadConfig: async () => makeConfig({
      display: { showClaudeCodeVersion: true },
    }),
    getGitStatus: async () => null,
    getClaudeCodeVersion: async () => {
      lookupCalls += 1;
      return "2.1.258";
    },
    render: (ctx) => {
      renderedContext = ctx;
    },
  });

  assert.equal(lookupCalls, 0);
  assert.equal(renderedContext?.claudeCodeVersion, "2.1.261");
});

test("main skips Claude Code version lookup when disabled", async () => {
  let lookupCalls = 0;

  await main({
    readStdin: async () => makeStdin(),
    parseTranscript: async () => makeTranscript(),
    countConfigs: async () => makeCounts(),
    loadConfig: async () => makeConfig({
      display: { showClaudeCodeVersion: false },
    }),
    getGitStatus: async () => null,
    getClaudeCodeVersion: async () => {
      lookupCalls += 1;
      return "2.1.81";
    },
    render: () => {},
  });

  assert.equal(lookupCalls, 0);
});

test("main includes memoryUsage in render context only for expanded layout when enabled", async () => {
  let renderedContext;
  let lookupCalls = 0;
  const mockMemoryUsage = {
    totalBytes: 16 * 1024 ** 3,
    usedBytes: 10 * 1024 ** 3,
    freeBytes: 6 * 1024 ** 3,
    usedPercent: 63,
  };

  await main({
    readStdin: async () => makeStdin(),
    parseTranscript: async () => makeTranscript(),
    countConfigs: async () => makeCounts(),
    loadConfig: async () => makeConfig({
      lineLayout: "expanded",
      display: { showMemoryUsage: true },
    }),
    getGitStatus: async () => null,
    getMemoryUsage: async () => {
      lookupCalls += 1;
      return mockMemoryUsage;
    },
    render: (ctx) => {
      renderedContext = ctx;
    },
  });

  assert.equal(lookupCalls, 1);
  assert.deepEqual(renderedContext?.memoryUsage, mockMemoryUsage);
});

test("main skips memoryUsage lookup for compact layout even when enabled", async () => {
  let lookupCalls = 0;

  await main({
    readStdin: async () => makeStdin(),
    parseTranscript: async () => makeTranscript(),
    countConfigs: async () => makeCounts(),
    loadConfig: async () => makeConfig({
      lineLayout: "compact",
      display: { showMemoryUsage: true },
    }),
    getGitStatus: async () => null,
    getMemoryUsage: async () => {
      lookupCalls += 1;
      return null;
    },
    render: () => {},
  });

  assert.equal(lookupCalls, 0);
});

test("main reads auth info only when an auth segment is enabled", async () => {
  let renderedContext;
  let lookupCalls = 0;

  await main({
    readStdin: async () => makeStdin(),
    parseTranscript: async () => makeTranscript(),
    countConfigs: async () => makeCounts(),
    loadConfig: async () => makeConfig({
      display: { showAuth: true, showAuthUser: false },
    }),
    getGitStatus: async () => null,
    readAuthInfo: () => {
      lookupCalls += 1;
      return { method: "API Key", user: null };
    },
    render: (ctx) => {
      renderedContext = ctx;
    },
  });

  assert.equal(lookupCalls, 1);
  assert.deepEqual(renderedContext?.authInfo, { method: "API Key", user: null });
});

test("main skips auth file I/O when auth segments are disabled", async () => {
  let renderedContext;
  let lookupCalls = 0;

  await main({
    readStdin: async () => makeStdin(),
    parseTranscript: async () => makeTranscript(),
    countConfigs: async () => makeCounts(),
    loadConfig: async () => makeConfig({
      display: { showAuth: false, showAuthUser: false },
    }),
    getGitStatus: async () => null,
    readAuthInfo: () => {
      lookupCalls += 1;
      return { method: "API Key", user: null };
    },
    render: (ctx) => {
      renderedContext = ctx;
    },
  });

  assert.equal(lookupCalls, 0);
  assert.equal(renderedContext?.authInfo, null);
});

test("main merges scoped windows from the external snapshot when stdin lacks them", async () => {
  let renderedContext;
  const scopedWindows = [{ label: "Fable", percent: 89, resetAt: new Date("2026-04-27T12:00:00.000Z") }];

  await main({
    readStdin: async () => makeStdin({
      rate_limits: {
        five_hour: { used_percentage: 49.6, resets_at: 1710000000 },
        seven_day: { used_percentage: 25.2, resets_at: 1710600000 },
      },
    }),
    parseTranscript: async () => makeTranscript(),
    countConfigs: async () => makeCounts(),
    loadConfig: async () => makeConfig({
      display: { externalUsagePath: "/tmp/usage.json" },
    }),
    getGitStatus: async () => null,
    getUsageFromExternalSnapshot: () => ({
      fiveHour: null,
      sevenDay: null,
      fiveHourResetAt: null,
      sevenDayResetAt: null,
      scopedWindows,
    }),
    render: (ctx) => {
      renderedContext = ctx;
    },
  });

  assert.deepEqual(renderedContext?.usageData?.scopedWindows, scopedWindows);
  assert.equal(renderedContext?.usageData?.fiveHour, 50);
  assert.equal(renderedContext?.usageData?.sevenDay, 25);
});

test("main prefers stdin scoped windows over the external snapshot", async () => {
  let renderedContext;

  await main({
    readStdin: async () => makeStdin({
      rate_limits: {
        five_hour: { used_percentage: 49.6, resets_at: 1710000000 },
        model_scoped: [
          { display_name: "Fable", utilization: 41, resets_at: "2026-04-27T12:00:00.000Z" },
        ],
      },
    }),
    parseTranscript: async () => makeTranscript(),
    countConfigs: async () => makeCounts(),
    loadConfig: async () => makeConfig({
      display: { externalUsagePath: "/tmp/usage.json" },
    }),
    getGitStatus: async () => null,
    getUsageFromExternalSnapshot: () => ({
      fiveHour: null,
      sevenDay: null,
      fiveHourResetAt: null,
      sevenDayResetAt: null,
      scopedWindows: [{ label: "Fable", percent: 99, resetAt: null }],
    }),
    render: (ctx) => {
      renderedContext = ctx;
    },
  });

  assert.deepEqual(renderedContext?.usageData?.scopedWindows, [
    { label: "Fable", percent: 41, resetAt: new Date("2026-04-27T12:00:00.000Z") },
  ]);
});

test("main preserves an explicit empty stdin scoped snapshot", async () => {
  let renderedContext;

  await main({
    readStdin: async () => makeStdin({
      rate_limits: {
        five_hour: { used_percentage: 49.6, resets_at: 1710000000 },
        model_scoped: [],
      },
    }),
    parseTranscript: async () => makeTranscript(),
    countConfigs: async () => makeCounts(),
    loadConfig: async () => makeConfig({
      display: { externalUsagePath: "/tmp/usage.json" },
    }),
    getGitStatus: async () => null,
    getUsageFromExternalSnapshot: () => ({
      fiveHour: null,
      sevenDay: null,
      fiveHourResetAt: null,
      sevenDayResetAt: null,
      scopedWindows: [{ label: "Stale", percent: 99, resetAt: null }],
    }),
    render: (ctx) => {
      renderedContext = ctx;
    },
  });

  assert.deepEqual(renderedContext?.usageData?.scopedWindows, []);
});

test("main uses a scoped-only external snapshot when stdin has no rate limits", async () => {
  let renderedContext;
  const scopedOnly = {
    fiveHour: null,
    sevenDay: null,
    fiveHourResetAt: null,
    sevenDayResetAt: null,
    scopedWindows: [{ label: "Fable", percent: 89, resetAt: null }],
  };

  await main({
    readStdin: async () => makeStdin({ rate_limits: null }),
    parseTranscript: async () => makeTranscript(),
    countConfigs: async () => makeCounts(),
    loadConfig: async () => makeConfig(),
    getGitStatus: async () => null,
    getUsageFromExternalSnapshot: () => scopedOnly,
    render: (ctx) => {
      renderedContext = ctx;
    },
  });

  assert.deepEqual(renderedContext?.usageData, scopedOnly);
});
