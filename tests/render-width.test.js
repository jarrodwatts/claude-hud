import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../dist/render/index.js';

function baseContext() {
  return {
    stdin: {
      model: { display_name: 'Opus' },
      context_window: {
        context_window_size: 200000,
        current_usage: {
          input_tokens: 10000,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    },
    transcript: { tools: [], agents: [], todos: [] },
    claudeMdCount: 0,
    rulesCount: 0,
    mcpCount: 0,
    hooksCount: 0,
    sessionDuration: '',
    gitStatus: null,
    usageData: null,
    config: {
      lineLayout: 'compact',
      showSeparators: false,
      pathLevels: 1,
      gitStatus: { enabled: true, showDirty: true, showAheadBehind: false, showFileStats: false },
      display: {
        showModel: true,
        showContextBar: true,
        contextValue: 'percent',
        showConfigCounts: true,
        showDuration: true,
        showSpeed: false,
        showTokenBreakdown: true,
        showUsage: true,
        usageBarEnabled: false,
        showTools: true,
        showAgents: true,
        showTodos: true,
        autocompactBuffer: 'enabled',
        usageThreshold: 0,
        sevenDayThreshold: 80,
        environmentThreshold: 0,
      },
    },
    extraLabel: null,
  };
}

function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function isWideCodePoint(codePoint) {
  return codePoint >= 0x1100 && (
    codePoint <= 0x115F ||
    codePoint === 0x2329 ||
    codePoint === 0x232A ||
    (codePoint >= 0x2E80 && codePoint <= 0xA4CF && codePoint !== 0x303F) ||
    (codePoint >= 0xAC00 && codePoint <= 0xD7A3) ||
    (codePoint >= 0xF900 && codePoint <= 0xFAFF) ||
    (codePoint >= 0xFE10 && codePoint <= 0xFE19) ||
    (codePoint >= 0xFE30 && codePoint <= 0xFE6F) ||
    (codePoint >= 0xFF00 && codePoint <= 0xFF60) ||
    (codePoint >= 0xFFE0 && codePoint <= 0xFFE6) ||
    (codePoint >= 0x1F300 && codePoint <= 0x1FAFF) ||
    (codePoint >= 0x20000 && codePoint <= 0x3FFFD)
  );
}

function displayWidth(text) {
  let width = 0;
  for (const char of Array.from(text)) {
    const codePoint = char.codePointAt(0);
    width += codePoint !== undefined && isWideCodePoint(codePoint) ? 2 : 1;
  }
  return width;
}

function withTerminal(columns, fn) {
  const originalColumns = process.stdout.columns;
  Object.defineProperty(process.stdout, 'columns', { value: columns, configurable: true });
  try {
    fn();
  } finally {
    if (originalColumns === undefined) {
      delete process.stdout.columns;
    } else {
      Object.defineProperty(process.stdout, 'columns', { value: originalColumns, configurable: true });
    }
  }
}

function captureRender(ctx) {
  const logs = [];
  const originalLog = console.log;
  console.log = line => logs.push(line);
  try {
    render(ctx);
  } finally {
    console.log = originalLog;
  }
  return logs.map(line => stripAnsi(line).replace(/\u00A0/g, ' '));
}

function countContaining(lines, needle) {
  return lines.filter(line => line.includes(needle)).length;
}

test('render wraps long lines to terminal width and keeps all activity lines visible', () => {
  const ctx = baseContext();
  ctx.stdin.model = { display_name: 'Sonnet 4.6' };
  ctx.stdin.cwd = '/tmp/very-long-project-name-for-terminal-wrap-checking';
  ctx.gitStatus = {
    branch: 'feature/this-is-a-very-long-branch-name',
    isDirty: true,
    ahead: 7,
    behind: 0,
    fileStats: { modified: 12, added: 4, deleted: 2, untracked: 9 },
  };
  ctx.config.gitStatus.showFileStats = true;
  ctx.claudeMdCount = 1;
  ctx.rulesCount = 2;
  ctx.hooksCount = 3;
  ctx.usageData = {
    planName: 'Team',
    fiveHour: 30,
    sevenDay: 3,
    fiveHourResetAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    sevenDayResetAt: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000),
  };
  ctx.transcript.tools = [
    { id: 'tool-1', name: 'Read', status: 'completed', startTime: new Date(0), endTime: new Date(0), duration: 0 },
  ];
  ctx.transcript.agents = [
    { id: 'agent-1', type: 'plan-a', status: 'running', startTime: new Date(0) },
    { id: 'agent-2', type: 'plan-b', status: 'completed', startTime: new Date(0), endTime: new Date(3000) },
    { id: 'agent-3', type: 'plan-c', status: 'completed', startTime: new Date(0), endTime: new Date(3500) },
  ];
  ctx.transcript.todos = [
    { content: 'todo-marker', status: 'in_progress' },
  ];

  let lines = [];
  withTerminal(20, () => {
    lines = captureRender(ctx);
  });

  assert.equal(countContaining(lines, 'Read'), 1, 'tool line should remain visible');
  assert.equal(countContaining(lines, 'plan-a'), 1, 'first agent line should remain visible');
  assert.equal(countContaining(lines, 'plan-b'), 1, 'second agent line should remain visible');
  assert.equal(countContaining(lines, 'plan-c'), 1, 'third agent line should remain visible');
  assert.equal(countContaining(lines, 'todo-marker'), 1, 'todo line should remain visible');
  assert.ok(lines.every(line => displayWidth(line) <= 20), 'all lines should fit terminal width');
});

test('render falls back to COLUMNS env when stdout.columns is unavailable', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '/tmp/project';
  ctx.extraLabel = '你好你好你好你好你好';
  const originalEnvColumns = process.env.COLUMNS;

  let lines = [];
  withTerminal(undefined, () => {
    process.env.COLUMNS = '10';
    try {
      lines = captureRender(ctx);
    } finally {
      if (originalEnvColumns === undefined) {
        delete process.env.COLUMNS;
      } else {
        process.env.COLUMNS = originalEnvColumns;
      }
    }
  });

  assert.ok(lines.length > 1, 'should still render output lines');
  assert.ok(lines.every(line => displayWidth(line) <= 10), 'all lines should fit COLUMNS width');
});

test('render prefers stdout columns over COLUMNS env fallback', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '/tmp/very-long-project-name-for-width-checking';
  const originalEnvColumns = process.env.COLUMNS;
  process.env.COLUMNS = '10';

  let lines = [];
  withTerminal(30, () => {
    lines = captureRender(ctx);
  });

  if (originalEnvColumns === undefined) {
    delete process.env.COLUMNS;
  } else {
    process.env.COLUMNS = originalEnvColumns;
  }

  assert.ok(lines.every(line => displayWidth(line) <= 30), 'stdout width should be honored');
  assert.ok(lines.some(line => displayWidth(line) > 10), 'stdout width should override COLUMNS fallback');
});

test('render does not split model/provider separator inside brackets', () => {
  const ctx = baseContext();
  ctx.stdin.model = { display_name: 'Sonnet', id: 'anthropic.claude-3-5-sonnet-20240620-v1:0' };
  ctx.config.display.showUsage = false;
  ctx.config.display.showContextBar = false;
  ctx.config.display.showConfigCounts = false;
  ctx.config.display.showDuration = false;

  let wideLines = [];
  withTerminal(80, () => {
    wideLines = captureRender(ctx);
  });

  assert.ok(wideLines.some(line => line.includes('[Sonnet | Bedrock]')), 'model/provider badge should be preserved when width allows');

  let lines = [];
  withTerminal(12, () => {
    lines = captureRender(ctx);
  });

  assert.equal(lines.length, 1, 'single compact line should be truncated, not split');
  assert.ok(!lines[0].startsWith('Bedrock]'), 'provider label should not become a wrapped prefix');
});

test('render clamps separator width in narrow terminals', () => {
  const ctx = baseContext();
  ctx.config.showSeparators = true;
  ctx.transcript.tools = [
    { id: 'tool-1', name: 'Read', status: 'completed', startTime: new Date(0), endTime: new Date(0), duration: 0 },
  ];

  let lines = [];
  withTerminal(8, () => {
    lines = captureRender(ctx);
  });

  const separatorLine = lines.find(line => line.includes('─'));
  assert.ok(separatorLine, 'separator should render when enabled with activity');
  assert.ok(displayWidth(separatorLine) <= 8, 'separator should fit terminal width');
});

test('render truncation respects Unicode display width', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '/tmp/project';
  ctx.extraLabel = '你好你好你好你好你好';

  let lines = [];
  withTerminal(10, () => {
    lines = captureRender(ctx);
  });

  assert.ok(lines.some(line => line.includes('...')), 'should truncate an overlong Unicode segment');
  assert.ok(lines.every(line => displayWidth(line) <= 10), 'all lines should respect terminal cell width');
});
