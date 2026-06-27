import { test } from "node:test";
import assert from "node:assert/strict";
import { setLanguage, getLanguage, getCanonicalLanguage, isCjkLanguage, t } from "../dist/i18n/index.js";
import { en } from "../dist/i18n/en.js";
import { zhHant } from "../dist/i18n/zh-Hant.js";
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
  assert.ok(line.includes("词元"), `expected '词元' in ${line}`);
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

test("getCanonicalLanguage resolves zh alias to zh-Hans", () => {
  setLanguage("zh");
  assert.equal(getCanonicalLanguage(), "zh-Hans");
  setLanguage("en");
});

test("getCanonicalLanguage returns zh-Hans for explicit zh-Hans", () => {
  setLanguage("zh-Hans");
  assert.equal(getCanonicalLanguage(), "zh-Hans");
  setLanguage("en");
});

test("getCanonicalLanguage returns en for English", () => {
  setLanguage("en");
  assert.equal(getCanonicalLanguage(), "en");
});

test("isCjkLanguage returns true for zh", () => {
  setLanguage("zh");
  assert.equal(isCjkLanguage(), true);
  setLanguage("en");
});

test("isCjkLanguage returns true for zh-Hans", () => {
  setLanguage("zh-Hans");
  assert.equal(isCjkLanguage(), true);
  setLanguage("en");
});

test("isCjkLanguage returns false for en", () => {
  setLanguage("en");
  assert.equal(isCjkLanguage(), false);
});

test("t() resolves translations via canonical mapping for zh-Hans", () => {
  setLanguage("zh-Hans");
  assert.equal(t("label.context"), "上下文");
  assert.equal(t("label.usage"), "用量");
  setLanguage("en");
});

test("mergeConfig accepts zh-Hans as valid language", () => {
  const config = mergeConfig({ language: "zh-Hans" });
  assert.equal(config.language, "zh-Hans");
});

// zh-Hant / zh-TW

test("t() returns Traditional Chinese strings when language is zh-Hant", () => {
  setLanguage("zh-Hant");
  assert.equal(t("label.context"), "上下文");
  assert.equal(t("label.usage"), "用量");
  assert.equal(t("label.approxRam"), "記憶體");
  assert.equal(t("label.promptCache"), "快取");
  assert.equal(t("label.rules"), "規則");
  assert.equal(t("label.hooks"), "Hook");
  assert.equal(t("status.limitReached"), "已達上限");
  assert.equal(t("status.allTodosComplete"), "全部完成");
  assert.equal(t("format.in"), "輸入");
  assert.equal(t("format.cache"), "快取");
  assert.equal(t("format.out"), "輸出");
  assert.equal(t("format.absoluteTime"), "{time}");
  assert.equal(t("format.relativeTime"), "{value} 前");
  setLanguage("en");
});

test("Traditional Chinese locale defines every English message key", () => {
  assert.deepEqual(Object.keys(zhHant).sort(), Object.keys(en).sort());
});

test("t() returns Traditional Chinese strings when language is zh-TW", () => {
  setLanguage("zh-TW");
  assert.equal(t("label.approxRam"), "記憶體");
  assert.equal(t("label.promptCache"), "快取");
  assert.equal(t("status.limitReached"), "已達上限");
  setLanguage("en");
});

test("getCanonicalLanguage resolves zh-Hant to zh-Hant", () => {
  setLanguage("zh-Hant");
  assert.equal(getCanonicalLanguage(), "zh-Hant");
  setLanguage("en");
});

test("getCanonicalLanguage resolves zh-TW alias to zh-Hant", () => {
  setLanguage("zh-TW");
  assert.equal(getCanonicalLanguage(), "zh-Hant");
  setLanguage("en");
});

test("isCjkLanguage returns true for zh-Hant", () => {
  setLanguage("zh-Hant");
  assert.equal(isCjkLanguage(), true);
  setLanguage("en");
});

test("isCjkLanguage returns true for zh-TW", () => {
  setLanguage("zh-TW");
  assert.equal(isCjkLanguage(), true);
  setLanguage("en");
});

test("renderSessionTokensLine uses Traditional Chinese labels for zh-Hant", () => {
  setLanguage("zh-Hant");
  const line = stripAnsi(renderSessionTokensLine(makeCtx()) ?? "");
  assert.ok(line.includes("Token"), `expected 'Token' in ${line}`);
  assert.ok(line.includes("輸入:"), `expected '輸入:' in ${line}`);
  assert.ok(line.includes("輸出:"), `expected '輸出:' in ${line}`);
  assert.ok(line.includes("快取:"), `expected '快取:' in ${line}`);
  assert.ok(!line.includes("in:"), `unexpected bare 'in:' in zh-Hant output: ${line}`);
  assert.ok(!line.includes("out:"), `unexpected bare 'out:' in zh-Hant output: ${line}`);
  assert.ok(!line.includes("cache:"), `unexpected bare 'cache:' in zh-Hant output: ${line}`);
  setLanguage("en");
});

test("mergeConfig accepts zh-Hant as valid language", () => {
  const config = mergeConfig({ language: "zh-Hant" });
  assert.equal(config.language, "zh-Hant");
});

test("mergeConfig accepts zh-TW as valid language", () => {
  const config = mergeConfig({ language: "zh-TW" });
  assert.equal(config.language, "zh-TW");
});
