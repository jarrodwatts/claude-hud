import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSkillsLine } from '../dist/render/lines/skills-line.js';
import { renderMcpLine } from '../dist/render/lines/mcp-line.js';
import { mergeConfig } from '../dist/config.js';

function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
}

function baseContext(overrides = {}) {
  return {
    stdin: {
      model: { display_name: 'Opus' },
      context_window: {
        context_window_size: 200000,
        current_usage: { input_tokens: 10000 },
      },
    },
    transcript: { tools: [], agents: [], todos: [] },
    claudeMdCount: 0,
    rulesCount: 0,
    mcpCount: 0,
    hooksCount: 0,
    skillNames: [],
    mcpServerNames: [],
    sessionDuration: '',
    gitStatus: null,
    usageData: null,
    memoryUsage: null,
    config: mergeConfig({}),
    extraLabel: null,
    ...overrides,
  };
}

// === renderSkillsLine ===

test('renderSkillsLine returns null when no skills', () => {
  const ctx = baseContext();
  assert.equal(renderSkillsLine(ctx), null);
});

test('renderSkillsLine renders a single skill', () => {
  const ctx = baseContext({ skillNames: ['opc'] });
  const result = stripAnsi(renderSkillsLine(ctx));
  assert.ok(result.includes('opc'));
  assert.ok(result.includes('◐'));
});

test('renderSkillsLine renders 4 skills without truncation', () => {
  const ctx = baseContext({ skillNames: ['a', 'b', 'c', 'd'] });
  const result = stripAnsi(renderSkillsLine(ctx));
  assert.ok(result.includes('a'));
  assert.ok(result.includes('d'));
  assert.ok(!result.includes('+'));
});

test('renderSkillsLine truncates at 5+ skills', () => {
  const ctx = baseContext({ skillNames: ['alpha', 'beta', 'gamma', 'delta', 'epsilon'] });
  const result = stripAnsi(renderSkillsLine(ctx));
  assert.ok(result.includes('alpha'));
  assert.ok(result.includes('delta'));
  assert.ok(result.includes('+1 more'));
  assert.ok(!result.includes('epsilon'));
});

// === renderMcpLine ===

test('renderMcpLine returns null when no servers', () => {
  const ctx = baseContext();
  assert.equal(renderMcpLine(ctx), null);
});

test('renderMcpLine renders a single server', () => {
  const ctx = baseContext({ mcpServerNames: ['filesystem'] });
  const result = stripAnsi(renderMcpLine(ctx));
  assert.ok(result.includes('filesystem'));
  assert.ok(result.includes('◐'));
});

test('renderMcpLine renders 4 servers without truncation', () => {
  const ctx = baseContext({ mcpServerNames: ['a', 'b', 'c', 'd'] });
  const result = stripAnsi(renderMcpLine(ctx));
  assert.ok(result.includes('a'));
  assert.ok(result.includes('d'));
  assert.ok(!result.includes('+'));
});

test('renderMcpLine truncates at 5+ servers', () => {
  const ctx = baseContext({ mcpServerNames: ['a', 'b', 'c', 'd', 'e', 'f'] });
  const result = stripAnsi(renderMcpLine(ctx));
  assert.ok(result.includes('+2 more'));
});

// === Config validation ===

test('mergeConfig includes skills and mcp in DEFAULT_ELEMENT_ORDER', () => {
  const config = mergeConfig({});
  assert.ok(config.elementOrder.includes('skills'));
  assert.ok(config.elementOrder.includes('mcp'));
});

test('mergeConfig defaults showSkills and showMcp to false', () => {
  const config = mergeConfig({});
  assert.equal(config.display.showSkills, false);
  assert.equal(config.display.showMcp, false);
});

test('mergeConfig respects showSkills and showMcp overrides', () => {
  const config = mergeConfig({ display: { showSkills: true, showMcp: true } });
  assert.equal(config.display.showSkills, true);
  assert.equal(config.display.showMcp, true);
});

// === Display toggle ===

test('renderSkillsLine returns null when skills exist but undefined skillNames', () => {
  const ctx = baseContext();
  delete ctx.skillNames;
  assert.equal(renderSkillsLine(ctx), null);
});

test('renderMcpLine returns null when undefined mcpServerNames', () => {
  const ctx = baseContext();
  delete ctx.mcpServerNames;
  assert.equal(renderMcpLine(ctx), null);
});
