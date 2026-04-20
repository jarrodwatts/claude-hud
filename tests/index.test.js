import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_CONFIG } from "../dist/config.js";
import { setLanguage } from "../dist/i18n/index.js";
import { formatSessionDuration, main } from "../dist/index.js";

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
    process.argv[1] = new URL(moduleUrl).pathname;
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
