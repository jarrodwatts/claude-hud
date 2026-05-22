import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";

const modulePath = "../dist/deepseek-balance.js";

function setEnv(name, value) {
  if (value === undefined || value === null) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function setupTempDir() {
  let dir;
  let cleanup;

  const setup = async () => {
    dir = await mkdtemp(path.join(tmpdir(), "claude-hud-deepseek-"));
    cleanup = async () => rm(dir, { recursive: true, force: true });
    process.env.CLAUDE_CONFIG_DIR = dir;
  };

  return { setup, cleanup: () => cleanup?.() };
}

async function importModule() {
  return import(`${modulePath}?t=${Date.now()}`);
}

test("getDeepSeekUsage returns null when ANTHROPIC_BASE_URL is not set", async () => {
  const { setup, cleanup } = setupTempDir();
  await setup();
  setEnv("ANTHROPIC_BASE_URL", undefined);
  setEnv("ANTHROPIC_AUTH_TOKEN", "sk-test-key");

  try {
    const { getDeepSeekUsage } = await importModule();
    const result = await getDeepSeekUsage();
    assert.equal(result, null);
  } finally {
    await cleanup();
  }
});

test("getDeepSeekUsage returns null when ANTHROPIC_BASE_URL does not contain deepseek", async () => {
  const { setup, cleanup } = setupTempDir();
  await setup();
  setEnv("ANTHROPIC_BASE_URL", "https://api.anthropic.com");
  setEnv("ANTHROPIC_AUTH_TOKEN", "sk-test-key");

  try {
    const { getDeepSeekUsage } = await importModule();
    const result = await getDeepSeekUsage();
    assert.equal(result, null);
  } finally {
    await cleanup();
  }
});

test("getDeepSeekUsage returns null when ANTHROPIC_AUTH_TOKEN is not set", async () => {
  const { setup, cleanup } = setupTempDir();
  await setup();
  setEnv("ANTHROPIC_BASE_URL", "https://api.deepseek.com/anthropic");
  setEnv("ANTHROPIC_AUTH_TOKEN", undefined);

  try {
    const { getDeepSeekUsage } = await importModule();
    const result = await getDeepSeekUsage();
    assert.equal(result, null);
  } finally {
    await cleanup();
  }
});

test("getDeepSeekUsage returns cached balance without calling API", async () => {
  const { setup, cleanup } = setupTempDir();
  await setup();
  setEnv("ANTHROPIC_BASE_URL", "https://api.deepseek.com/anthropic");
  setEnv("ANTHROPIC_AUTH_TOKEN", "sk-test-key");

  const pluginDir = path.join(process.env.CLAUDE_CONFIG_DIR, "plugins", "claude-hud");
  await mkdir(pluginDir, { recursive: true });
  await writeFile(
    path.join(pluginDir, ".deepseek-cache.json"),
    JSON.stringify({ updatedAt: Date.now(), balanceLabel: "Balance ¥42.00" }),
    "utf8",
  );

  try {
    const { getDeepSeekUsage } = await importModule();
    const result = await getDeepSeekUsage();
    assert.notEqual(result, null);
    assert.equal(result.balanceLabel, "Balance ¥42.00");
    assert.equal(result.fiveHour, null);
    assert.equal(result.sevenDay, null);
    assert.equal(result.fiveHourResetAt, null);
    assert.equal(result.sevenDayResetAt, null);
  } finally {
    await cleanup();
  }
});

test("getDeepSeekUsage ignores expired cache and fetches from API", async () => {
  const { setup, cleanup } = setupTempDir();
  await setup();
  setEnv("ANTHROPIC_BASE_URL", "https://api.deepseek.com/anthropic");
  setEnv("ANTHROPIC_AUTH_TOKEN", "sk-test-key");

  const pluginDir = path.join(process.env.CLAUDE_CONFIG_DIR, "plugins", "claude-hud");
  await mkdir(pluginDir, { recursive: true });
  // Write an expired cache entry (6 minutes old, TTL is 5 min)
  await writeFile(
    path.join(pluginDir, ".deepseek-cache.json"),
    JSON.stringify({ updatedAt: Date.now() - 6 * 60 * 1000, balanceLabel: "Balance ¥42.00" }),
    "utf8",
  );

  // Mock fetch to return fresh data
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.deepseek.com/user/balance");
    assert.equal(options.headers.Authorization, "Bearer sk-test-key");
    return {
      ok: true,
      json: async () => ({
        is_available: true,
        balance_infos: [{ currency: "CNY", total_balance: "99.50", granted_balance: "0.00", topped_up_balance: "99.50" }],
      }),
    };
  };

  try {
    const { getDeepSeekUsage } = await importModule();
    const result = await getDeepSeekUsage();
    assert.notEqual(result, null);
    assert.equal(result.balanceLabel, "Balance ¥99.50");

    // Verify cache was updated
    const cacheRaw = await readFile(path.join(pluginDir, ".deepseek-cache.json"), "utf8");
    const cache = JSON.parse(cacheRaw);
    assert.equal(cache.balanceLabel, "Balance ¥99.50");
  } finally {
    globalThis.fetch = originalFetch;
    await cleanup();
  }
});

test("getDeepSeekUsage handles API error gracefully", async () => {
  const { setup, cleanup } = setupTempDir();
  await setup();
  setEnv("ANTHROPIC_BASE_URL", "https://api.deepseek.com/anthropic");
  setEnv("ANTHROPIC_AUTH_TOKEN", "sk-test-key");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 402,
  });

  try {
    const { getDeepSeekUsage } = await importModule();
    const result = await getDeepSeekUsage();
    assert.equal(result, null);
  } finally {
    globalThis.fetch = originalFetch;
    await cleanup();
  }
});

test("getDeepSeekUsage handles malformed API response gracefully", async () => {
  const { setup, cleanup } = setupTempDir();
  await setup();
  setEnv("ANTHROPIC_BASE_URL", "https://api.deepseek.com/anthropic");
  setEnv("ANTHROPIC_AUTH_TOKEN", "sk-test-key");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ is_available: true }), // no balance_infos
  });

  try {
    const { getDeepSeekUsage } = await importModule();
    const result = await getDeepSeekUsage();
    assert.equal(result, null);
  } finally {
    globalThis.fetch = originalFetch;
    await cleanup();
  }
});

test("getDeepSeekUsage handles fetch timeout gracefully", async () => {
  const { setup, cleanup } = setupTempDir();
  await setup();
  setEnv("ANTHROPIC_BASE_URL", "https://api.deepseek.com/anthropic");
  setEnv("ANTHROPIC_AUTH_TOKEN", "sk-test-key");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("fetch failed");
  };

  try {
    const { getDeepSeekUsage } = await importModule();
    const result = await getDeepSeekUsage();
    assert.equal(result, null);
  } finally {
    globalThis.fetch = originalFetch;
    await cleanup();
  }
});
