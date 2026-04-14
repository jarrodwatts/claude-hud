import { test } from "node:test";
import assert from "node:assert/strict";
import { setLanguage } from "../dist/i18n/index.js";
import {
  paddedLabel,
  _plainTextWidth,
  _maxLabelWidth,
} from "../dist/render/lines/label-align.js";

// Strip ANSI escape sequences for content inspection.
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

test("plainTextWidth counts ASCII as 1 cell each", () => {
  assert.equal(_plainTextWidth("Context"), 7);
  assert.equal(_plainTextWidth("Usage"), 5);
  assert.equal(_plainTextWidth("Weekly"), 6);
});

test("plainTextWidth counts CJK characters as 2 cells each", () => {
  // 上下文 = 3 chars × 2 cells = 6
  assert.equal(_plainTextWidth("上下文"), 6);
  // 用量 = 2 chars × 2 cells = 4
  assert.equal(_plainTextWidth("用量"), 4);
  // 本周 = 2 chars × 2 cells = 4
  assert.equal(_plainTextWidth("本周"), 4);
});

test("English labels are right-padded to equal visual width (7)", () => {
  setLanguage("en");

  // "Context" = 7 (max), no padding needed
  // "Usage"   = 5, needs 2 spaces
  // "Weekly"  = 6, needs 1 space
  assert.equal(_maxLabelWidth(), 7);

  const context = stripAnsi(paddedLabel("label.context"));
  const usage = stripAnsi(paddedLabel("label.usage"));
  const weekly = stripAnsi(paddedLabel("label.weekly"));

  assert.equal(context, "Context");
  assert.equal(usage, "Usage  ");
  assert.equal(weekly, "Weekly ");

  // All have the same visual width
  assert.equal(_plainTextWidth(context), 7);
  assert.equal(_plainTextWidth(usage), 7);
  assert.equal(_plainTextWidth(weekly), 7);
});

test("Chinese labels are right-padded correctly (CJK awareness)", () => {
  setLanguage("zh");

  // 上下文 = 6 cells (max), 用量 = 4 cells, 本周 = 4 cells
  assert.equal(_maxLabelWidth(), 6);

  const context = stripAnsi(paddedLabel("label.context"));
  const usage = stripAnsi(paddedLabel("label.usage"));
  const weekly = stripAnsi(paddedLabel("label.weekly"));

  // 上下文 needs no padding
  assert.equal(context, "上下文");
  // 用量 needs 2 spaces (6 - 4 = 2)
  assert.equal(usage, "用量  ");
  // 本周 needs 2 spaces (6 - 4 = 2)
  assert.equal(weekly, "本周  ");

  // All have the same visual width
  assert.equal(_plainTextWidth(context), 6);
  assert.equal(_plainTextWidth(usage), 6);
  assert.equal(_plainTextWidth(weekly), 6);

  // Restore
  setLanguage("en");
});

test("paddedLabel output includes trailing spaces for shorter labels", () => {
  setLanguage("en");

  const usage = stripAnsi(paddedLabel("label.usage"));
  const weekly = stripAnsi(paddedLabel("label.weekly"));

  // "Usage" gets 2 trailing spaces, "Weekly" gets 1
  assert.ok(usage.endsWith("  "), `Expected trailing spaces in "${usage}"`);
  assert.ok(weekly.endsWith(" "), `Expected trailing space in "${weekly}"`);
});

test("paddedLabel wraps text with ANSI dim codes", () => {
  setLanguage("en");

  const result = paddedLabel("label.context");
  // Should contain ANSI escape sequences (dim + reset)
  assert.ok(result.includes("\x1b["), "Expected ANSI escape codes in output");
  // The visible text should be "Context" with no padding (it's the widest)
  assert.equal(stripAnsi(result), "Context");
});
