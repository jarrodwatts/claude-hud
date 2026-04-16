import { test } from "node:test";
import assert from "node:assert/strict";
import { setLanguage, getLanguage, t } from "../dist/i18n/index.js";
import { mergeConfig } from "../dist/config.js";
import { renderSessionTokensLine } from "../dist/render/lines/session-tokens.js";

function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function makeCtx(overrides = {}) {
  return {
    stdin: {},
    transcript: {
      tools: [],
      agents: [],
      todos: [],
      sessionTokens: {
        inputTokens: 12345,
        outputTokens: 6789,
        cacheCreationTokens: 0,
        cacheReadTokens: 4321,
      },
    },
    claudeMdCount: 0,
    rulesCount: 0,
    mcpCount: 0,
    hooksCount: 0,
    sessionDuration: "",
    gitStatus: null,
    usageData: null,
    memoryUsage: null,
    config: {
      display: { showSessionTokens: true },
      colors: { label: "dim" },
    },
    extraLabel: null,
    ...overrides,
  };
}

test("t() returns English strings by default", () => {
  setLanguage("en");
  assert.equal(t("label.context"), "Context");
  assert.equal(t("label.usage"), "Usage");
  assert.equal(t("label.approxRam"), "Approx RAM");
  assert.equal(t("status.limitReached"), "Limit reached");
  assert.equal(t("status.allTodosComplete"), "All todos complete");
});

test("t() returns Chinese strings when language is zh", () => {
  setLanguage("zh");
  assert.equal(t("label.context"), "上下文");
  assert.equal(t("label.usage"), "用量");
  assert.equal(t("label.approxRam"), "内存");
  assert.equal(t("label.rules"), "规则");
  assert.equal(t("label.hooks"), "钩子");
  assert.equal(t("status.limitReached"), "已达上限");
  assert.equal(t("status.allTodosComplete"), "全部完成");
  assert.equal(t("format.in"), "输入");
  assert.equal(t("format.cache"), "缓存");
  assert.equal(t("format.out"), "输出");
  // Restore
  setLanguage("en");
});

test("setLanguage and getLanguage round-trip", () => {
  setLanguage("zh");
  assert.equal(getLanguage(), "zh");
  setLanguage("en");
  assert.equal(getLanguage(), "en");
});

test("mergeConfig defaults to English when no language is specified", () => {
  const config = mergeConfig({});
  assert.equal(config.language, "en");
});

test("mergeConfig preserves explicit language from config", () => {
  const config = mergeConfig({ language: "zh" });
  assert.equal(config.language, "zh");

  const config2 = mergeConfig({ language: "en" });
  assert.equal(config2.language, "en");
});

test("mergeConfig falls back to English for invalid language", () => {
  const config = mergeConfig({ language: "invalid" });
  assert.equal(config.language, "en");
});

test("renderSessionTokensLine uses translated labels in English", () => {
  setLanguage("en");
  const line = stripAnsi(renderSessionTokensLine(makeCtx()) ?? "");
  assert.ok(line.includes("Tokens"), `expected 'Tokens' in ${line}`);
  assert.ok(line.includes("in:"), `expected 'in:' in ${line}`);
  assert.ok(line.includes("out:"), `expected 'out:' in ${line}`);
  assert.ok(line.includes("cache:"), `expected 'cache:' in ${line}`);
});

test("renderSessionTokensLine uses translated labels in Chinese", () => {
  setLanguage("zh");
  const line = stripAnsi(renderSessionTokensLine(makeCtx()) ?? "");
  assert.ok(line.includes("令牌"), `expected '令牌' in ${line}`);
  assert.ok(line.includes("输入:"), `expected '输入:' in ${line}`);
  assert.ok(line.includes("输出:"), `expected '输出:' in ${line}`);
  assert.ok(line.includes("缓存:"), `expected '缓存:' in ${line}`);
  // No leftover English labels
  assert.ok(!line.includes("in:"), `unexpected bare 'in:' label in zh output: ${line}`);
  assert.ok(!line.includes("out:"), `unexpected bare 'out:' label in zh output: ${line}`);
  assert.ok(!line.includes("cache:"), `unexpected bare 'cache:' label in zh output: ${line}`);
  assert.ok(!line.includes("Tokens"), `unexpected bare 'Tokens' label in zh output: ${line}`);
  setLanguage("en");
});
