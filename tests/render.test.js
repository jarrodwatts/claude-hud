import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { render } from '../dist/render/index.js';
import { renderSessionLine } from '../dist/render/session-line.js';
import { renderProjectLine, renderGitFilesLine } from '../dist/render/lines/project.js';
import { renderPromptCacheLine } from '../dist/render/lines/prompt-cache.js';
import { renderToolsLine } from '../dist/render/tools-line.js';
import { renderAgentsLine } from '../dist/render/agents-line.js';
import { renderTodosLine } from '../dist/render/todos-line.js';
import { renderUsageLine } from '../dist/render/lines/usage.js';
import { renderMemoryLine } from '../dist/render/lines/memory.js';
import { renderIdentityLine } from '../dist/render/lines/identity.js';
import { renderEnvironmentLine } from '../dist/render/lines/environment.js';
import { renderSessionTokensLine } from '../dist/render/lines/session-tokens.js';
import { getContextColor, getQuotaColor } from '../dist/render/colors.js';
import { setLanguage } from '../dist/i18n/index.js';

function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
}

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
    transcript: { tools: [], agents: [], todos: [], sessionTokens: undefined },
    claudeMdCount: 0,
    rulesCount: 0,
    mcpCount: 0,
    hooksCount: 0,
    sessionDuration: '',
    gitStatus: null,
    usageData: null,
    memoryUsage: null,
    config: {
      lineLayout: 'compact',
      showSeparators: false,
      pathLevels: 1,
      elementOrder: ['project', 'context', 'usage', 'promptCache', 'memory', 'environment', 'tools', 'agents', 'todos'],
      gitStatus: { enabled: true, showDirty: true, showAheadBehind: false, showFileStats: false, branchOverflow: 'truncate', pushWarningThreshold: 0, pushCriticalThreshold: 0 },
      display: { showModel: true, showProject: true, showContextBar: true, contextValue: 'percent', showConfigCounts: true, showCost: false, showDuration: true, showSpeed: false, showTokenBreakdown: true, showUsage: true, usageBarEnabled: false, showResetLabel: true, showTools: true, showAgents: true, showTodos: true, showSessionTokens: false, showSessionName: false, showClaudeCodeVersion: false, showMemoryUsage: false, showPromptCache: false, promptCacheTtlSeconds: 300, showOutputStyle: false, mergeGroups: [['context', 'usage']], autocompactBuffer: 'enabled', usageThreshold: 0, sevenDayThreshold: 80, environmentThreshold: 0, customLine: '' },
      colors: {
        context: 'green',
        usage: 'brightBlue',
        warning: 'yellow',
        usageWarning: 'brightMagenta',
        critical: 'red',
        model: 'cyan',
        project: 'yellow',
        git: 'magenta',
        gitBranch: 'cyan',
        label: 'dim',
        custom: 208,
      },
    },
  };
}

function captureRenderLines(ctx) {
  const logs = [];
  const originalLog = console.log;
  console.log = line => logs.push(stripAnsi(line));
  try {
    render(ctx);
  } finally {
    console.log = originalLog;
  }
  return logs;
}

function withColumns(stream, columns, fn) {
  const originalColumns = stream.columns;
  Object.defineProperty(stream, 'columns', { value: columns, configurable: true });
  try {
    return fn();
  } finally {
    if (originalColumns === undefined) {
      delete stream.columns;
    } else {
      Object.defineProperty(stream, 'columns', { value: originalColumns, configurable: true });
    }
  }
}

function withTerminal(columns, fn) {
  return withColumns(process.stdout, columns, fn);
}

async function withDeterministicSpeedCache(fn) {
  const tempConfigDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-render-'));
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
  const originalNow = Date.now;
  const cachePath = path.join(tempConfigDir, 'plugins', 'claude-hud', '.speed-cache.json');

  process.env.CLAUDE_CONFIG_DIR = tempConfigDir;
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify({ outputTokens: 1000, timestamp: 1000 }), 'utf8');
  Date.now = () => 2000;

  try {
    await fn();
  } finally {
    Date.now = originalNow;
    if (originalConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR;
    } else {
      process.env.CLAUDE_CONFIG_DIR = originalConfigDir;
    }
    await rm(tempConfigDir, { recursive: true, force: true });
  }
}

test('renderSessionLine adds token breakdown when context is high', () => {
  const ctx = baseContext();
  // For 90%: (tokens + 33000) / 200000 = 0.9 → tokens = 147000
  ctx.stdin.context_window.current_usage.input_tokens = 147000;
  const line = renderSessionLine(ctx);
  assert.ok(line.includes('in:'), 'expected token breakdown');
  assert.ok(line.includes('cache:'), 'expected cache breakdown');
});

test('renderSessionLine includes duration and formats large tokens', () => {
  const ctx = baseContext();
  ctx.sessionDuration = '1m';
  // Use 1M context, need 85%+ to show breakdown
  // For 85%: (tokens + 165000) / 1000000 = 0.85 → tokens = 685000
  ctx.stdin.context_window.context_window_size = 1000000;
  ctx.stdin.context_window.current_usage.input_tokens = 685000;
  ctx.stdin.context_window.current_usage.cache_read_input_tokens = 1500;
  const line = renderSessionLine(ctx);
  assert.ok(line.includes('⏱️'));
  assert.ok(line.includes('685k') || line.includes('685.0k'), 'expected large input token display');
  assert.ok(line.includes('2k'), 'expected cache token display');
});

test('renderSessionLine handles missing input tokens and cache creation usage', () => {
  const ctx = baseContext();
  // For 90%: (tokens + 33000) / 200000 = 0.9 → tokens = 147000 (all from cache)
  ctx.stdin.context_window.context_window_size = 200000;
  ctx.stdin.context_window.current_usage = {
    cache_creation_input_tokens: 147000,
  };
  const line = renderSessionLine(ctx);
  assert.ok(line.includes('90%'));
  assert.ok(line.includes('in: 0'));
});

test('renderSessionLine handles missing cache token fields', () => {
  const ctx = baseContext();
  // For 90%: (tokens + 33000) / 200000 = 0.9 → tokens = 147000
  ctx.stdin.context_window.context_window_size = 200000;
  ctx.stdin.context_window.current_usage = {
    input_tokens: 147000,
  };
  const line = renderSessionLine(ctx);
  assert.ok(line.includes('cache: 0'));
});

test('getContextColor returns yellow for warning threshold', () => {
  assert.equal(getContextColor(70), '\x1b[33m');
});

test('getContextColor and getQuotaColor respect custom semantic overrides', () => {
  const colors = {
    context: 'cyan',
    usage: 'magenta',
    warning: 'brightBlue',
    usageWarning: 'yellow',
    critical: 'red',
  };

  assert.equal(getContextColor(10, colors), '\x1b[36m');
  assert.equal(getContextColor(70, colors), '\x1b[94m');
  assert.equal(getQuotaColor(25, colors), '\x1b[35m');
  assert.equal(getQuotaColor(80, colors), '\x1b[33m');
});

test('getContextColor and getQuotaColor resolve 256-color indices', () => {
  const colors = {
    context: 82,
    usage: 214,
    warning: 220,
    usageWarning: 97,
    critical: 196,
  };

  assert.equal(getContextColor(10, colors), '\x1b[38;5;82m');
  assert.equal(getContextColor(70, colors), '\x1b[38;5;220m');
  assert.equal(getContextColor(90, colors), '\x1b[38;5;196m');
  assert.equal(getQuotaColor(25, colors), '\x1b[38;5;214m');
  assert.equal(getQuotaColor(80, colors), '\x1b[38;5;97m');
  assert.equal(getQuotaColor(95, colors), '\x1b[38;5;196m');
});

test('getContextColor and getQuotaColor resolve hex color strings', () => {
  const colors = {
    context: '#33ff00',
    usage: '#FFB000',
    warning: '#ff87d7',
    usageWarning: '#af87ff',
    critical: '#ff0000',
  };

  assert.equal(getContextColor(10, colors), '\x1b[38;2;51;255;0m');
  assert.equal(getContextColor(70, colors), '\x1b[38;2;255;135;215m');
  assert.equal(getQuotaColor(25, colors), '\x1b[38;2;255;176;0m');
  assert.equal(getQuotaColor(80, colors), '\x1b[38;2;175;135;255m');
});

test('renderSessionLine includes config counts when present', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '/tmp/my-project';
  ctx.claudeMdCount = 1;
  ctx.rulesCount = 2;
  ctx.mcpCount = 3;
  ctx.hooksCount = 4;
  const line = renderSessionLine(ctx);
  assert.ok(line.includes('CLAUDE.md'));
  assert.ok(line.includes('rules'));
  assert.ok(line.includes('MCPs'));
  assert.ok(line.includes('hooks'));
});

test('renderSessionLine displays project name from POSIX cwd', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '/Users/jarrod/my-project';
  const line = renderSessionLine(ctx);
  assert.ok(line.includes('my-project'));
  assert.ok(!line.includes('/Users/jarrod'));
});

test('renderSessionLine displays project name from Windows cwd', { skip: process.platform !== 'win32' }, () => {
  const ctx = baseContext();
  ctx.stdin.cwd = 'C:\\Users\\jarrod\\my-project';
  const line = renderSessionLine(ctx);
  assert.ok(line.includes('my-project'));
  assert.ok(!line.includes('C:\\'));
});

test('renderSessionLine handles root path gracefully', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '/';
  const line = renderSessionLine(ctx);
  assert.ok(line.includes('[Opus]'));
});

test('renderSessionLine supports token-based context display', () => {
  const ctx = baseContext();
  ctx.config.display.contextValue = 'tokens';
  ctx.stdin.context_window.context_window_size = 200000;
  ctx.stdin.context_window.current_usage.input_tokens = 12345;
  const line = renderSessionLine(ctx);
  assert.ok(line.includes('12k/200k'), 'should include token counts');
});

test('renderSessionLine supports remaining-based context display', () => {
  const ctx = baseContext();
  ctx.config.display.contextValue = 'remaining';
  ctx.stdin.context_window.context_window_size = 200000;
  ctx.stdin.context_window.current_usage.input_tokens = 12345;
  const line = renderSessionLine(ctx);
  // 12345/200k = 6.17% raw, scale ≈ 0.026, buffer ≈ 858 → 7% buffered → 93% remaining
  assert.ok(line.includes('93%'), 'should include remaining percentage');
});

test('renderSessionLine supports combined context display', () => {
  const ctx = baseContext();
  ctx.config.display.contextValue = 'both';
  ctx.stdin.context_window.context_window_size = 200000;
  ctx.stdin.context_window.current_usage.input_tokens = 12345;
  const line = renderSessionLine(ctx);
  assert.ok(line.includes('7% (12k/200k)'), 'should include percentage and token counts');
});

test('render expanded layout supports remaining-based context display', () => {
  const ctx = baseContext();
  ctx.config.lineLayout = 'expanded';
  ctx.config.display.contextValue = 'remaining';
  ctx.stdin.context_window.context_window_size = 200000;
  ctx.stdin.context_window.current_usage.input_tokens = 12345;

  const logs = [];
  const originalLog = console.log;
  console.log = (line) => logs.push(line);
  try {
    render(ctx);
  } finally {
    console.log = originalLog;
  }

  // 12345/200k = 6.17% raw, scale ≈ 0.026, buffer ≈ 858 → 7% buffered → 93% remaining
  assert.ok(logs.some(line => line.includes('Context') && line.includes('93%')), 'expected remaining percentage on context line');
});

test('render expanded layout supports combined context display', () => {
  const ctx = baseContext();
  ctx.config.lineLayout = 'expanded';
  ctx.config.display.contextValue = 'both';
  ctx.stdin.context_window.context_window_size = 200000;
  ctx.stdin.context_window.current_usage.input_tokens = 12345;

  const logs = [];
  const originalLog = console.log;
  console.log = (line) => logs.push(line);
  try {
    render(ctx);
  } finally {
    console.log = originalLog;
  }

  assert.ok(
    logs.some(line => line.includes('Context') && line.includes('7% (12k/200k)')),
    'expected combined percentage and token counts on context line'
  );
});

test('render expanded layout includes prompt cache as its own opt-in element', () => {
  const ctx = baseContext();
  ctx.config.lineLayout = 'expanded';
  ctx.config.display.showPromptCache = true;
  ctx.transcript.lastAssistantResponseAt = new Date(Date.now() - 45_000);

  const lines = captureRenderLines(ctx);
  assert.ok(lines.some(line => line.includes('Cache ⏱ 4m 15s')), `should render prompt cache line, got: ${lines.join(' | ')}`);
});

test('renderSessionLine omits project name when cwd is undefined', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = undefined;
  const line = renderSessionLine(ctx);
  assert.ok(line.includes('[Opus]'));
});

test('renderSessionLine includes session name when showSessionName is true', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '/tmp/my-project';
  ctx.transcript.sessionName = 'Renamed Session';
  ctx.config.display.showSessionName = true;
  const line = renderSessionLine(ctx);
  assert.ok(line.includes('Renamed Session'));
});

test('renderSessionLine includes Claude Code version when enabled', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '/tmp/my-project';
  ctx.config.display.showClaudeCodeVersion = true;
  ctx.claudeCodeVersion = '2.1.81';
  const line = stripAnsi(renderSessionLine(ctx));
  assert.ok(line.includes('CC v2.1.81'));
});

test('renderPromptCacheLine returns null when disabled or missing transcript data', () => {
  const ctx = baseContext();
  assert.equal(renderPromptCacheLine(ctx), null);

  ctx.config.display.showPromptCache = true;
  assert.equal(renderPromptCacheLine(ctx), null);
});

test('renderSessionLine includes prompt cache countdown when enabled', () => {
  const ctx = baseContext();
  ctx.config.display.showPromptCache = true;
  ctx.transcript.lastAssistantResponseAt = new Date(Date.now() - 30_000);

  const line = stripAnsi(renderSessionLine(ctx));
  assert.ok(line.includes('Cache ⏱ 4m 30s'), `should include prompt cache countdown, got: ${line}`);
});

test('renderSessionLine hides session name by default', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '/tmp/my-project';
  ctx.transcript.sessionName = 'Renamed Session';
  const line = renderSessionLine(ctx);
  assert.ok(!line.includes('Renamed Session'));
});

test('renderSessionLine includes customLine when configured', () => {
  const ctx = baseContext();
  ctx.config.display.customLine = 'Ship it';
  const line = stripAnsi(renderSessionLine(ctx));
  assert.ok(line.includes('Ship it'));
});

test('renderSessionLine applies modelFormat compact', () => {
  const ctx = baseContext();
  ctx.stdin.model = { display_name: 'Opus 4.6 (1M context)' };
  ctx.config.display.modelFormat = 'compact';
  const line = stripAnsi(renderSessionLine(ctx));
  assert.ok(line.includes('Opus 4.6'));
  assert.ok(!line.includes('context'));
});

test('renderSessionLine applies modelOverride', () => {
  const ctx = baseContext();
  ctx.stdin.model = { display_name: 'Claude Opus' };
  ctx.config.display.modelOverride = 'My AI';
  const line = stripAnsi(renderSessionLine(ctx));
  assert.ok(line.includes('My AI'));
  assert.ok(!line.includes('Claude Opus'));
});

test('renderProjectLine includes session name when showSessionName is true', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '/tmp/my-project';
  ctx.transcript.sessionName = 'Renamed Session';
  ctx.config.display.showSessionName = true;
  const line = renderProjectLine(ctx);
  assert.ok(line?.includes('Renamed Session'));
});

test('renderProjectLine includes Claude Code version when enabled', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '/tmp/my-project';
  ctx.config.display.showClaudeCodeVersion = true;
  ctx.claudeCodeVersion = '2.1.81';
  const line = stripAnsi(renderProjectLine(ctx));
  assert.ok(line.includes('CC v2.1.81'));
});

test('renderMemoryLine shows approximate system RAM usage in expanded layout when enabled', () => {
  const ctx = baseContext();
  ctx.config.lineLayout = 'expanded';
  ctx.config.display.showMemoryUsage = true;
  ctx.memoryUsage = {
    totalBytes: 16 * 1024 ** 3,
    usedBytes: 10 * 1024 ** 3,
    freeBytes: 6 * 1024 ** 3,
    usedPercent: 63,
  };

  const line = stripAnsi(renderMemoryLine(ctx));

  assert.ok(line.includes('Approx RAM'));
  assert.ok(line.includes('10 GB / 16 GB'));
  assert.ok(line.includes('(63%)'));
});

test('renderMemoryLine stays hidden in compact layout even when enabled', () => {
  const ctx = baseContext();
  ctx.config.display.showMemoryUsage = true;
  ctx.memoryUsage = {
    totalBytes: 16 * 1024 ** 3,
    usedBytes: 10 * 1024 ** 3,
    freeBytes: 6 * 1024 ** 3,
    usedPercent: 63,
  };

  assert.equal(renderMemoryLine(ctx), null);
});

test('renderProjectLine includes extraLabel when present', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '/tmp/my-project';
  ctx.extraLabel = 'user [MAX]';
  const line = renderProjectLine(ctx);
  assert.ok(line?.includes('user [MAX]'));
});

test('renderProjectLine omits extraLabel when null', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '/tmp/my-project';
  ctx.extraLabel = null;
  const line = renderProjectLine(ctx);
  assert.ok(!line?.includes('user [MAX]'));
});

test('renderProjectLine hides session name by default', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '/tmp/my-project';
  ctx.transcript.sessionName = 'Renamed Session';
  const line = renderProjectLine(ctx);
  assert.ok(!line?.includes('Renamed Session'));
});

test('renderProjectLine includes customLine when configured', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '/tmp/my-project';
  ctx.config.display.customLine = 'Stay sharp';
  const line = stripAnsi(renderProjectLine(ctx) ?? '');
  assert.ok(line.includes('Stay sharp'));
});

test('renderProjectLine applies modelFormat compact (strips context suffix)', () => {
  const ctx = baseContext();
  ctx.stdin.model = { display_name: 'Opus 4.6 (1M context)' };
  ctx.config.display.modelFormat = 'compact';
  const line = stripAnsi(renderProjectLine(ctx) ?? '');
  assert.ok(line.includes('Opus 4.6'));
  assert.ok(!line.includes('context'));
});

test('renderProjectLine applies modelFormat short (strips Claude prefix and context)', () => {
  const ctx = baseContext();
  ctx.stdin.model = { display_name: 'Claude Sonnet 3.5 (200k context)' };
  ctx.config.display.modelFormat = 'short';
  const line = stripAnsi(renderProjectLine(ctx) ?? '');
  assert.ok(line.includes('Sonnet 3.5'));
  assert.ok(!line.includes('Claude'));
  assert.ok(!line.includes('context'));
});

test('renderProjectLine applies modelOverride as custom name', () => {
  const ctx = baseContext();
  ctx.stdin.model = { display_name: 'Claude Opus 4.5' };
  ctx.config.display.modelOverride = "zane's intelligent opus";
  const line = stripAnsi(renderProjectLine(ctx) ?? '');
  assert.ok(line.includes("zane's intelligent opus"));
  assert.ok(!line.includes('Claude Opus'));
});

test('renderProjectLine modelOverride takes precedence over modelFormat', () => {
  const ctx = baseContext();
  ctx.stdin.model = { display_name: 'Claude Opus 4.5 (1M context)' };
  ctx.config.display.modelFormat = 'short';
  ctx.config.display.modelOverride = 'My Custom Model';
  const line = stripAnsi(renderProjectLine(ctx) ?? '');
  assert.ok(line.includes('My Custom Model'));
});

test('renderProjectLine uses configurable element colors', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '/tmp/my-project';
  ctx.config.display.customLine = 'Stay sharp';
  ctx.gitStatus = { branch: 'main', isDirty: false, ahead: 0, behind: 0 };
  ctx.config.colors.model = 214;
  ctx.config.colors.project = 82;
  ctx.config.colors.git = 220;
  ctx.config.colors.gitBranch = '#33ff00';
  ctx.config.colors.custom = '#ff6600';

  const line = renderProjectLine(ctx);
  assert.ok(line?.includes('\x1b[38;5;214m[Opus]\x1b[0m'));
  assert.ok(line?.includes('\x1b[38;5;82mmy-project\x1b[0m'));
  assert.ok(line?.includes('\x1b[38;5;220mgit:(\x1b[0m'));
  assert.ok(line?.includes('\x1b[38;2;51;255;0mmain\x1b[0m'));
  assert.ok(line?.includes('\x1b[38;2;255;102;0mStay sharp\x1b[0m'));
});

test('label color overrides apply across shared secondary text surfaces', () => {
  const ctx = baseContext();
  ctx.config.colors.label = '#abcdef';
  ctx.stdin.cwd = '/tmp/my-project';
  ctx.claudeMdCount = 2;
  ctx.rulesCount = 1;
  ctx.gitStatus = { branch: 'main', isDirty: false, ahead: 0, behind: 0 };
  ctx.usageData = {
    fiveHour: 25,
    sevenDay: null,
    fiveHourResetAt: null,
    sevenDayResetAt: null,
  };
  ctx.memoryUsage = {
    totalBytes: 1000,
    usedBytes: 500,
    freeBytes: 500,
    usedPercent: 50,
  };
  ctx.config.display.showMemoryUsage = true;
  ctx.transcript.tools = [
    { id: 'tool-1', name: 'Read', target: 'src/index.ts', status: 'running', startTime: new Date(0) },
  ];
  ctx.transcript.agents = [
    { id: 'agent-1', type: 'planner', model: 'haiku', description: 'Inspecting', status: 'running', startTime: new Date(0) },
  ];
  ctx.transcript.todos = [
    { content: 'Ship it', status: 'in_progress' },
    { content: 'Done', status: 'completed' },
  ];

  const expected = '\x1b[38;2;171;205;239m';
  assert.ok(renderIdentityLine(ctx).includes(`${expected}Context\x1b[0m`));
  assert.ok(renderUsageLine(ctx)?.includes(`${expected}Usage\x1b[0m`));
  assert.ok(renderUsageLine(ctx, true)?.includes(`${expected}Usage  \x1b[0m`));
  assert.ok(renderEnvironmentLine(ctx)?.includes(`${expected}2 CLAUDE.md | 1 rules\x1b[0m`));
  assert.ok(renderMemoryLine({ ...ctx, config: { ...ctx.config, lineLayout: 'expanded', display: { ...ctx.config.display, showMemoryUsage: true } } })?.includes(`${expected}Approx RAM\x1b[0m`));
  assert.ok(renderToolsLine(ctx)?.includes(`${expected}: src/index.ts\x1b[0m`));
  assert.ok(renderAgentsLine(ctx)?.includes(`${expected}[haiku]\x1b[0m`));
  assert.ok(renderTodosLine(ctx)?.includes(`${expected}(1/2)\x1b[0m`));
});

test('renderEnvironmentLine shows output style when enabled', () => {
  const ctx = baseContext();
  ctx.outputStyle = 'tech-leader';
  ctx.config.display.showConfigCounts = false;
  ctx.config.display.showOutputStyle = true;

  assert.ok(renderEnvironmentLine(ctx)?.includes('style: tech-leader'));
});

test('renderEnvironmentLine appends output style after config counts', () => {
  const ctx = baseContext();
  ctx.claudeMdCount = 1;
  ctx.outputStyle = 'learning';
  ctx.config.display.showOutputStyle = true;

  const line = renderEnvironmentLine(ctx);
  assert.ok(line?.includes('1 CLAUDE.md'));
  assert.ok(line?.includes('style: learning'));
});

test('renderProjectLine includes duration when showDuration is true', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '/tmp/my-project';
  ctx.config.display.showDuration = true;
  ctx.sessionDuration = '12m 34s';
  const line = renderProjectLine(ctx);
  assert.ok(line?.includes('12m 34s'), 'should include session duration');
});

test('renderSessionLine shows native cost when stdin cost.total_cost_usd is available', () => {
  const ctx = baseContext();
  ctx.config.display.showCost = true;
  ctx.stdin.cost = { total_cost_usd: 5.47 };

  const line = stripAnsi(renderSessionLine(ctx));
  assert.ok(line.includes('Cost $5.47'));
});

test('renderProjectLine falls back to an estimate when native cost is absent', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '/tmp/my-project';
  ctx.config.display.showCost = true;
  ctx.stdin.model = { display_name: 'Claude Opus 4.5' };
  ctx.transcript.sessionTokens = {
    inputTokens: 100000,
    cacheCreationTokens: 10000,
    cacheReadTokens: 20000,
    outputTokens: 50000,
  };

  const line = stripAnsi(renderProjectLine(ctx));
  assert.ok(line.includes('Est. $5.47'), `expected fallback estimate, got: ${line}`);
});

test('renderProjectLine hides cost for provider-routed sessions', () => {
  process.env.CLAUDE_CODE_USE_BEDROCK = '1';
  try {
    const ctx = baseContext();
    ctx.stdin.cwd = '/tmp/my-project';
    ctx.stdin.model = { id: 'anthropic.claude-sonnet-4-20250514-v1:0' };
    ctx.config.display.showCost = true;
    ctx.stdin.cost = { total_cost_usd: 0 };
    ctx.transcript.sessionTokens = {
      inputTokens: 100000,
      cacheCreationTokens: 10000,
      cacheReadTokens: 20000,
      outputTokens: 50000,
    };

    const line = stripAnsi(renderProjectLine(ctx));
    assert.ok(!line.includes('Cost '), 'cost should stay hidden when billing is routed through the provider');
  } finally {
    delete process.env.CLAUDE_CODE_USE_BEDROCK;
  }
});

test('renderProjectLine translates native cost label when Chinese is enabled', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '/tmp/my-project';
  ctx.config.display.showCost = true;
  ctx.stdin.cost = { total_cost_usd: 5.47 };

  setLanguage('zh');
  try {
    const line = stripAnsi(renderProjectLine(ctx));
    assert.ok(line.includes('费用 $5.47'));
  } finally {
    setLanguage('en');
  }
});

test('renderProjectLine omits duration when showDuration is false', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '/tmp/my-project';
  ctx.config.display.showDuration = false;
  ctx.sessionDuration = '12m 34s';
  const line = renderProjectLine(ctx);
  assert.ok(!line?.includes('12m 34s'), 'should not include session duration when disabled');
});

test('renderProjectLine includes speed when showSpeed is true and speed is available', async () => {
  await withDeterministicSpeedCache(async () => {
    const ctx = baseContext();
    ctx.stdin.cwd = '/tmp/my-project';
    ctx.stdin.context_window.current_usage.output_tokens = 2000;
    ctx.config.display.showSpeed = true;

    const line = renderProjectLine(ctx);
    assert.ok(line?.includes('out: 1000.0 tok/s'), 'should include deterministic speed');
  });
});

test('renderProjectLine omits speed when showSpeed is false', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '/tmp/my-project';
  ctx.config.display.showSpeed = false;
  ctx.stdin.context_window.current_usage.output_tokens = 5000;
  const line = renderProjectLine(ctx);
  assert.ok(!line?.includes('tok/s'), 'should not include speed when disabled');
});

test('render expanded layout includes speed and duration on the project line', async () => {
  await withDeterministicSpeedCache(async () => {
    const ctx = baseContext();
    ctx.config.lineLayout = 'expanded';
    ctx.stdin.cwd = '/tmp/my-project';
    ctx.stdin.context_window.current_usage.output_tokens = 2000;
    ctx.config.display.showSpeed = true;
    ctx.sessionDuration = '12m 34s';

    const lines = withTerminal(120, () => captureRenderLines(ctx));
    const projectLine = lines.find(line => line.includes('my-project'));

    assert.ok(projectLine, 'expected an expanded project line');
    assert.ok(projectLine.includes('out: 1000.0 tok/s'), 'should include deterministic speed');
    assert.ok(projectLine.includes('⏱️  12m 34s'), 'should include session duration');
  });
});

test('renderSessionLine omits project name when showProject is false', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '/Users/jarrod/my-project';
  ctx.gitStatus = { branch: 'main', isDirty: true, ahead: 0, behind: 0 };
  ctx.config.display.showProject = false;
  const line = renderSessionLine(ctx);
  assert.ok(!line.includes('my-project'), 'should not include project name when showProject is false');
  assert.ok(line.includes('git:('), 'should still include git status when showProject is false');
});

test('renderProjectLine keeps git status when showProject is false', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '/Users/jarrod/my-project';
  ctx.gitStatus = { branch: 'main', isDirty: true, ahead: 0, behind: 0 };
  ctx.config.display.showProject = false;
  const line = renderProjectLine(ctx);
  assert.ok(line?.includes('git:('), 'should still include git status');
  assert.ok(!line?.includes('my-project'), 'should hide project path');
});

test('renderSessionLine displays git branch when present', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '/tmp/my-project';
  ctx.gitStatus = { branch: 'main', isDirty: false, ahead: 0, behind: 0 };
  const line = renderSessionLine(ctx);
  assert.ok(line.includes('git:('));
  assert.ok(line.includes('main'));
});

test('renderSessionLine omits git branch when null', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '/tmp/my-project';
  ctx.gitStatus = null;
  const line = renderSessionLine(ctx);
  assert.ok(!line.includes('git:('));
});

test('renderSessionLine displays branch with slashes', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '/tmp/my-project';
  ctx.gitStatus = { branch: 'feature/add-auth', isDirty: false, ahead: 0, behind: 0 };
  const line = renderSessionLine(ctx);
  assert.ok(line.includes('git:('));
  assert.ok(line.includes('feature/add-auth'));
});

test('renderSessionLine can give git its own segment for wrapping', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '/tmp/my-project';
  ctx.gitStatus = { branch: 'feature/add-auth', isDirty: false, ahead: 0, behind: 0 };
  ctx.config.gitStatus.branchOverflow = 'wrap';
  const line = stripAnsi(renderSessionLine(ctx));
  assert.ok(line.includes('my-project | git:(feature/add-auth)'), 'git should render as a separate segment');
});

test('renderProjectLine can give git its own segment for wrapping', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '/tmp/my-project';
  ctx.gitStatus = { branch: 'feature/add-auth', isDirty: false, ahead: 0, behind: 0 };
  ctx.config.gitStatus.branchOverflow = 'wrap';
  const line = stripAnsi(renderProjectLine(ctx) ?? '');
  assert.ok(line.includes('my-project │ git:(feature/add-auth)'), 'git should render as a separate segment');
});

test('renderToolsLine renders running and completed tools', () => {
  const ctx = baseContext();
  ctx.transcript.tools = [
    {
      id: 'tool-1',
      name: 'Read',
      status: 'completed',
      startTime: new Date(0),
      endTime: new Date(0),
      duration: 0,
    },
    {
      id: 'tool-2',
      name: 'Edit',
      target: '/tmp/very/long/path/to/authentication.ts',
      status: 'running',
      startTime: new Date(0),
    },
  ];

  const line = renderToolsLine(ctx);
  assert.ok(line?.includes('Read'));
  assert.ok(line?.includes('Edit'));
  assert.ok(line?.includes('.../authentication.ts'));
});

test('renderToolsLine truncates long filenames', () => {
  const ctx = baseContext();
  ctx.transcript.tools = [
    {
      id: 'tool-1',
      name: 'Edit',
      target: '/tmp/this-is-a-very-very-long-filename.ts',
      status: 'running',
      startTime: new Date(0),
    },
  ];

  const line = renderToolsLine(ctx);
  assert.ok(line?.includes('...'));
  assert.ok(!line?.includes('/tmp/'));
});

test('renderToolsLine handles trailing slash paths', () => {
  const ctx = baseContext();
  ctx.transcript.tools = [
    {
      id: 'tool-1',
      name: 'Read',
      target: '/tmp/very/long/path/with/trailing/',
      status: 'running',
      startTime: new Date(0),
    },
  ];

  const line = renderToolsLine(ctx);
  assert.ok(line?.includes('...'));
});

test('renderToolsLine preserves short targets and handles missing targets', () => {
  const ctx = baseContext();
  ctx.transcript.tools = [
    {
      id: 'tool-1',
      name: 'Read',
      target: 'short.txt',
      status: 'running',
      startTime: new Date(0),
    },
    {
      id: 'tool-2',
      name: 'Write',
      status: 'running',
      startTime: new Date(0),
    },
  ];

  const line = renderToolsLine(ctx);
  assert.ok(line?.includes('short.txt'));
  assert.ok(line?.includes('Write'));
});

test('renderToolsLine returns null when tools are unrecognized', () => {
  const ctx = baseContext();
  ctx.transcript.tools = [
    {
      id: 'tool-1',
      name: 'WeirdTool',
      status: 'unknown',
      startTime: new Date(0),
    },
  ];

  assert.equal(renderToolsLine(ctx), null);
});

test('renderAgentsLine returns null when no agents exist', () => {
  const ctx = baseContext();
  assert.equal(renderAgentsLine(ctx), null);
});

test('renderAgentsLine renders completed agents', () => {
  const ctx = baseContext();
  ctx.transcript.agents = [
    {
      id: 'agent-1',
      type: 'explore',
      model: 'haiku',
      description: 'Finding auth code',
      status: 'completed',
      startTime: new Date(0),
      endTime: new Date(0),
      elapsed: 0,
    },
  ];

  const line = renderAgentsLine(ctx);
  assert.ok(line?.includes('explore'));
  assert.ok(line?.includes('haiku'));
});

test('renderAgentsLine truncates long descriptions and formats elapsed time', () => {
  const ctx = baseContext();
  ctx.transcript.agents = [
    {
      id: 'agent-1',
      type: 'explore',
      model: 'haiku',
      description: 'A very long description that should be truncated in the HUD output',
      status: 'completed',
      startTime: new Date(0),
      endTime: new Date(1500),
    },
    {
      id: 'agent-2',
      type: 'analyze',
      status: 'completed',
      startTime: new Date(0),
      endTime: new Date(65000),
    },
  ];

  const line = renderAgentsLine(ctx);
  assert.ok(line?.includes('...'));
  assert.ok(line?.includes('2s'));
  assert.ok(line?.includes('1m'));
});

test('renderAgentsLine renders running agents with live elapsed time', () => {
  const ctx = baseContext();
  const originalNow = Date.now;
  Date.now = () => 2000;

  try {
    ctx.transcript.agents = [
      {
        id: 'agent-1',
        type: 'plan',
        status: 'running',
        startTime: new Date(0),
      },
    ];

    const line = renderAgentsLine(ctx);
    assert.ok(line?.includes('◐'));
    assert.ok(line?.includes('2s'));
  } finally {
    Date.now = originalNow;
  }
});

test('renderAgentsLine formats elapsed time in hours for long-running agents', () => {
  const ctx = baseContext();
  ctx.transcript.agents = [
    {
      id: 'agent-1',
      type: 'plan',
      status: 'completed',
      startTime: new Date(0),
      endTime: new Date((2 * 60 * 60 + 5 * 60) * 1000),
    },
  ];

  const line = renderAgentsLine(ctx);
  assert.ok(line?.includes('2h 5m'));
});

test('renderAgentsLine clamps negative elapsed time to under one second', () => {
  const ctx = baseContext();
  ctx.transcript.agents = [
    {
      id: 'agent-1',
      type: 'plan',
      status: 'completed',
      startTime: new Date(5000),
      endTime: new Date(1000),
    },
  ];

  const line = renderAgentsLine(ctx);
  assert.ok(line?.includes('<1s'));
});

test('renderTodosLine handles in-progress and completed-only cases', () => {
  const ctx = baseContext();
  ctx.transcript.todos = [
    { content: 'First task', status: 'completed' },
    { content: 'Second task', status: 'in_progress' },
  ];
  assert.ok(renderTodosLine(ctx)?.includes('Second task'));

  ctx.transcript.todos = [{ content: 'First task', status: 'completed' }];
  assert.ok(renderTodosLine(ctx)?.includes('All todos complete'));
});

test('renderTodosLine returns null when no todos are in progress', () => {
  const ctx = baseContext();
  ctx.transcript.todos = [
    { content: 'First task', status: 'completed' },
    { content: 'Second task', status: 'pending' },
  ];
  assert.equal(renderTodosLine(ctx), null);
});

test('renderTodosLine truncates long todo content', () => {
  const ctx = baseContext();
  ctx.transcript.todos = [
    {
      content: 'This is a very long todo content that should be truncated for display',
      status: 'in_progress',
    },
  ];
  const line = renderTodosLine(ctx);
  assert.ok(line?.includes('...'));
});

test('renderTodosLine returns null when no todos exist', () => {
  const ctx = baseContext();
  assert.equal(renderTodosLine(ctx), null);
});

test('renderToolsLine returns null when no tools exist', () => {
  const ctx = baseContext();
  assert.equal(renderToolsLine(ctx), null);
});

// Usage display tests
test('renderSessionLine does not add a synthetic subscriber label from usageData', () => {
  const ctx = baseContext();
  ctx.usageData = {
    planName: 'Max',
    fiveHour: 23,
    sevenDay: 45,
    fiveHourResetAt: null,
    sevenDayResetAt: null,
  };
  const line = renderSessionLine(ctx);
  assert.ok(line.includes('Opus'), 'should include model name');
  assert.ok(!line.includes('Max'), 'should not include plan name derived outside stdin');
});

test('renderSessionLine does not guess API auth from environment variables alone', () => {
  const ctx = baseContext();
  ctx.usageData = {
    planName: 'Max',
    fiveHour: 23,
    sevenDay: 45,
    fiveHourResetAt: null,
    sevenDayResetAt: null,
  };
  const savedApiKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-key';

  try {
    const line = renderSessionLine(ctx);
    assert.ok(!line.includes('API'), 'should not guess API auth from ANTHROPIC_API_KEY alone');
    assert.ok(!line.includes('Max'), 'should not include subscriber plan label');
  } finally {
    if (savedApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = savedApiKey;
    }
  }
});

test('renderProjectLine does not guess API auth from environment variables alone', () => {
  const ctx = baseContext();
  ctx.usageData = {
    planName: 'Pro',
    fiveHour: 10,
    sevenDay: 20,
    fiveHourResetAt: null,
    sevenDayResetAt: null,
  };
  const savedApiKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-key';

  try {
    const line = renderProjectLine(ctx);
    assert.ok(!line?.includes('API'), 'should not guess API auth from ANTHROPIC_API_KEY alone');
    assert.ok(!line?.includes('Pro'), 'should not include subscriber plan label');
  } finally {
    if (savedApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = savedApiKey;
    }
  }
});

test('renderIdentityLine translates labels when Chinese is enabled', () => {
  const ctx = baseContext();
  setLanguage('zh');
  try {
    const line = stripAnsi(renderIdentityLine(ctx));
    assert.ok(line.includes('上下文'));
  } finally {
    setLanguage('en');
  }
});

test('renderUsageLine translates labels when Chinese is enabled', () => {
  const ctx = baseContext();
  ctx.usageData = {
    planName: 'Pro',
    fiveHour: 25,
    sevenDay: 10,
    fiveHourResetAt: new Date(Date.now() + 60 * 60 * 1000),
    sevenDayResetAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
  };

  setLanguage('zh');
  try {
    const line = stripAnsi(renderUsageLine(ctx) ?? '');
    assert.ok(line.includes('用量'));
    assert.ok(line.includes('重置剩余'));
  } finally {
    setLanguage('en');
  }
});

test('renderSessionLine shows Bedrock label and hides usage for bedrock model ids', () => {
  process.env.CLAUDE_CODE_USE_BEDROCK = '1';
  try {
    const ctx = baseContext();
    ctx.stdin.model = { display_name: 'Sonnet', id: 'anthropic.claude-3-5-sonnet-20240620-v1:0' };
    ctx.usageData = {
      planName: 'Max',
      fiveHour: 23,
      sevenDay: 45,
      fiveHourResetAt: null,
      sevenDayResetAt: null,
    };
    const line = renderSessionLine(ctx);
    assert.ok(line.includes('Sonnet'), 'should include model name');
    assert.ok(line.includes('Bedrock'), 'should include Bedrock label');
    assert.ok(!line.includes('5h'), 'should hide usage display');
  } finally {
    delete process.env.CLAUDE_CODE_USE_BEDROCK;
  }
});

test('renderSessionLine displays usage percentages (7d hidden when low)', () => {
  const ctx = baseContext();
  ctx.config.display.sevenDayThreshold = 80;
  ctx.usageData = {
    planName: 'Pro',
    fiveHour: 6,
    sevenDay: 13,
    fiveHourResetAt: null,
    sevenDayResetAt: null,
  };
  const line = renderSessionLine(ctx);
  assert.ok(line.includes('5h'), 'should include 5h label');
  assert.ok(!line.includes('Weekly'), 'should NOT include 7d when below 80%');
  assert.ok(line.includes('6%'), 'should include 5h percentage');
});

test('renderSessionLine shows 7d when approaching limit (>=80%)', () => {
  const ctx = baseContext();
  ctx.config.display.sevenDayThreshold = 80;
  ctx.usageData = {
    planName: 'Pro',
    fiveHour: 45,
    sevenDay: 85,
    fiveHourResetAt: null,
    sevenDayResetAt: null,
  };
  const line = renderSessionLine(ctx);
  assert.ok(line.includes('5h'), 'should include 5h label');
  assert.ok(line.includes('Weekly'), 'should include 7d when >= 80%');
  assert.ok(line.includes('85%'), 'should include 7d percentage');
});

test('renderSessionLine shows 7d reset countdown in text-only mode', () => {
  const ctx = baseContext();
  const resetTime = new Date(Date.now() + (28 * 60 * 60 * 1000)); // 1d 4h from now
  ctx.config.display.sevenDayThreshold = 80;
  ctx.config.display.usageBarEnabled = false;
  ctx.usageData = {
    planName: 'Pro',
    fiveHour: 45,
    sevenDay: 85,
    fiveHourResetAt: null,
    sevenDayResetAt: resetTime,
  };

  const line = stripAnsi(renderSessionLine(ctx));
  assert.ok(line.includes('Weekly 85%'), `should include 7d label and percentage: ${line}`);
  assert.ok(line.includes('(resets in 1d 4h)'), `should include 7d reset countdown in text-only mode: ${line}`);
});

test('renderSessionLine respects sevenDayThreshold override', () => {
  const ctx = baseContext();
  ctx.config.display.sevenDayThreshold = 0;
  ctx.usageData = {
    planName: 'Pro',
    fiveHour: 10,
    sevenDay: 5,
    fiveHourResetAt: null,
    sevenDayResetAt: null,
  };

  const line = renderSessionLine(ctx);
  assert.ok(line.includes('Weekly'), 'should include 7d when threshold is 0');
});

test('renderSessionLine shows weekly-only usage without a ghost 5h section', () => {
  const ctx = baseContext();
  ctx.config.display.sevenDayThreshold = 80;
  ctx.usageData = {
    planName: 'Pro',
    fiveHour: null,
    sevenDay: 13,
    fiveHourResetAt: null,
    sevenDayResetAt: null,
  };

  const line = stripAnsi(renderSessionLine(ctx));
  assert.ok(!line.includes('5h'), `should not render a ghost 5h section: ${line}`);
  assert.ok(line.includes('Weekly'), `should render the weekly window when it is the only usage value: ${line}`);
  assert.ok(line.includes('13%'), `should render the weekly percentage: ${line}`);
});

test('renderSessionLine shows 5hr reset countdown', () => {
  const ctx = baseContext();
  const resetTime = new Date(Date.now() + 7200000); // 2 hours from now
  ctx.usageData = {
    planName: 'Pro',
    fiveHour: 45,
    sevenDay: 20,
    fiveHourResetAt: resetTime,
    sevenDayResetAt: null,
  };
  const line = renderSessionLine(ctx);
  assert.ok(line.includes('5h'), 'should include 5h label');
  assert.ok(line.includes('2h'), 'should include reset countdown');
});

test('renderUsageLine shows reset countdown in days when >= 24 hours', () => {
  const ctx = baseContext();
  const resetTime = new Date(Date.now() + (151 * 3600000) + (59 * 60000)); // 6d 7h 59m from now
  ctx.config.display.usageBarEnabled = true;
  ctx.usageData = {
    planName: 'Pro',
    fiveHour: 45,
    sevenDay: 20,
    fiveHourResetAt: resetTime,
    sevenDayResetAt: null,
  };
  const line = renderUsageLine(ctx);
  assert.ok(line, 'should render usage line');
  const plain = stripAnsi(line);
  assert.ok(plain.includes('(resets in 6d 7h)'), `expected bar-mode reset wording, got: ${plain}`);
  assert.ok(!plain.includes('151h'), `should avoid raw hour format for long durations: ${plain}`);
});

test('renderUsageLine shows 7d reset countdown in text-only mode', () => {
  const ctx = baseContext();
  const resetTime = new Date(Date.now() + (28 * 60 * 60 * 1000)); // 1d 4h from now
  ctx.config.display.usageBarEnabled = false;
  ctx.config.display.sevenDayThreshold = 80;
  ctx.usageData = {
    planName: 'Pro',
    fiveHour: 45,
    sevenDay: 85,
    fiveHourResetAt: null,
    sevenDayResetAt: resetTime,
  };

  const line = stripAnsi(renderUsageLine(ctx));
  assert.ok(line.includes('5h 45%'), `should include 5h text-only usage: ${line}`);
  assert.ok(line.includes('Weekly 85%'), `should include 7d text-only usage: ${line}`);
  assert.ok(line.includes('(resets in 1d 4h)'), `should include 7d reset countdown in text-only mode: ${line}`);
});

test('renderUsageLine can hide reset label in text-only mode', () => {
  const ctx = baseContext();
  const resetTime = new Date(Date.now() + (28 * 60 * 60 * 1000));
  ctx.config.display.usageBarEnabled = false;
  ctx.config.display.showResetLabel = false;
  ctx.config.display.sevenDayThreshold = 80;
  ctx.usageData = {
    planName: 'Pro',
    fiveHour: 45,
    sevenDay: 85,
    fiveHourResetAt: null,
    sevenDayResetAt: resetTime,
  };

  const line = stripAnsi(renderUsageLine(ctx));
  assert.ok(line.includes('(1d 4h)'), `should include bare countdown when reset label is hidden: ${line}`);
  assert.ok(!line.includes('resets in'), `should omit reset label when disabled: ${line}`);
});

test('renderUsageLine translates weekly label when Chinese is enabled', () => {
  const ctx = baseContext();
  ctx.config.display.sevenDayThreshold = 80;
  ctx.usageData = {
    planName: 'Pro',
    fiveHour: 45,
    sevenDay: 85,
    fiveHourResetAt: null,
    sevenDayResetAt: new Date(Date.now() + (28 * 60 * 60 * 1000)),
  };

  setLanguage('zh');
  try {
    const line = stripAnsi(renderUsageLine(ctx) ?? '');
    assert.ok(line.includes('本周'));
    assert.ok(line.includes('重置剩余'));
  } finally {
    setLanguage('en');
  }
});

test('renderUsageLine shows 7d reset countdown in bar mode when above threshold', () => {
  const ctx = baseContext();
  const resetTime = new Date(Date.now() + (28 * 60 * 60 * 1000)); // 1d 4h from now
  ctx.config.display.usageBarEnabled = true;
  ctx.config.display.sevenDayThreshold = 80;
  ctx.usageData = {
    planName: 'Pro',
    fiveHour: 45,
    sevenDay: 85,
    fiveHourResetAt: null,
    sevenDayResetAt: resetTime,
  };

  const line = stripAnsi(renderUsageLine(ctx));
  assert.ok(line.includes('45%'), `should include 5h percentage in bar mode: ${line}`);
  assert.ok(line.includes('85%'), `should include 7d percentage: ${line}`);
  assert.ok(line.includes('(resets in 1d 4h)'), `should include 7d reset countdown in bar mode: ${line}`);
  assert.ok(line.includes('|'), `should render both usage windows above the threshold: ${line}`);
});

test('renderUsageLine can hide reset label in bar mode', () => {
  const ctx = baseContext();
  const resetTime = new Date(Date.now() + (28 * 60 * 60 * 1000));
  ctx.config.display.usageBarEnabled = true;
  ctx.config.display.showResetLabel = false;
  ctx.config.display.sevenDayThreshold = 80;
  ctx.usageData = {
    planName: 'Pro',
    fiveHour: 45,
    sevenDay: 85,
    fiveHourResetAt: null,
    sevenDayResetAt: resetTime,
  };

  const line = stripAnsi(renderUsageLine(ctx));
  assert.ok(line.includes('(1d 4h)'), `should include bare countdown in bar mode: ${line}`);
  assert.ok(!line.includes('resets in'), `should omit reset label in bar mode when disabled: ${line}`);
});

test('renderUsageLine shows weekly-only usage without a ghost 5h section', () => {
  const ctx = baseContext();
  ctx.config.display.sevenDayThreshold = 80;
  ctx.usageData = {
    planName: 'Pro',
    fiveHour: null,
    sevenDay: 13,
    fiveHourResetAt: null,
    sevenDayResetAt: null,
  };

  const line = stripAnsi(renderUsageLine(ctx));
  assert.ok(line.includes('Usage'), `should render usage line: ${line}`);
  assert.ok(!line.includes('5h'), `should not render a ghost 5h section: ${line}`);
  assert.ok(line.includes('Weekly'), `should render the weekly window when it is the only usage value: ${line}`);
  assert.ok(line.includes('13%'), `should render the weekly percentage: ${line}`);
  assert.ok(!line.includes('|'), `should not render a separator for a missing 5h window: ${line}`);
});

test('renderSessionLine displays limit reached warning', () => {
  const ctx = baseContext();
  const resetTime = new Date(Date.now() + 3600000); // 1 hour from now
  ctx.usageData = {
    planName: 'Pro',
    fiveHour: 100,
    sevenDay: 45,
    fiveHourResetAt: resetTime,
    sevenDayResetAt: null,
  };
  const line = renderSessionLine(ctx);
  assert.ok(line.includes('Limit reached'), 'should show limit reached');
  assert.ok(line.includes('resets'), 'should show reset time');
});

test('renderUsageLine shows limit reset in days when >= 24 hours', () => {
  const ctx = baseContext();
  const resetTime = new Date(Date.now() + (151 * 3600000) + (59 * 60000)); // 6d 7h 59m from now
  ctx.usageData = {
    planName: 'Pro',
    fiveHour: 100,
    sevenDay: 45,
    fiveHourResetAt: resetTime,
    sevenDayResetAt: null,
  };
  const line = renderUsageLine(ctx);
  assert.ok(line, 'should render usage line');
  const plain = stripAnsi(line);
  assert.ok(plain.includes('Limit reached'), 'should show limit reached');
  assert.ok(/resets in \d+d( \d+h)?/.test(plain), `expected day/hour reset format, got: ${plain}`);
  assert.ok(!plain.includes('151h'), `should avoid raw hour format for long durations: ${plain}`);
});

test('renderSessionLine displays -- for null usage values', () => {
  const ctx = baseContext();
  ctx.usageData = {
    planName: 'Max',
    fiveHour: null,
    sevenDay: null,
    fiveHourResetAt: null,
    sevenDayResetAt: null,
  };
  const line = renderSessionLine(ctx);
  assert.ok(line.includes('5h'), 'should include 5h label');
  assert.ok(line.includes('--'), 'should show -- for null values');
});

test('renderSessionLine omits usage when usageData is null', () => {
  const ctx = baseContext();
  ctx.usageData = null;
  const line = renderSessionLine(ctx);
  assert.ok(!line.includes('5h'), 'should not include 5h label');
  assert.ok(!line.includes('Weekly'), 'should not include 7d label');
});

test('renderSessionLine uses custom critical colors for limit-reached usage state', () => {
  const ctx = baseContext();
  ctx.config.colors = {
    context: 'green',
    usage: 'brightBlue',
    warning: 'cyan',
    usageWarning: 'brightMagenta',
    critical: 'magenta',
  };
  ctx.usageData = {
    planName: 'Pro',
    fiveHour: 100,
    sevenDay: 45,
    fiveHourResetAt: new Date(Date.now() + 3600000),
    sevenDayResetAt: null,
  };

  const criticalLine = renderSessionLine(ctx);
  assert.ok(criticalLine.includes('\x1b[35m⚠ Limit reached'), `expected custom critical color, got: ${JSON.stringify(criticalLine)}`);
});

test('renderUsageLine uses custom usage palette overrides', () => {
  const ctx = baseContext();
  ctx.config.display.usageBarEnabled = true;
  ctx.config.colors = {
    context: 'green',
    usage: 'cyan',
    warning: 'yellow',
    usageWarning: 'magenta',
    critical: 'red',
  };
  ctx.usageData = {
    planName: 'Pro',
    fiveHour: 25,
    sevenDay: 80,
    fiveHourResetAt: null,
    sevenDayResetAt: null,
  };

  const line = withTerminal(120, () => renderUsageLine(ctx));
  assert.ok(line, 'should render usage line');
  assert.ok(line.includes('\x1b[36m███'), `expected custom usage bar color, got: ${JSON.stringify(line)}`);
  assert.ok(line.includes('\x1b[36m25%\x1b[0m'), `expected custom usage percentage color, got: ${JSON.stringify(line)}`);
  assert.ok(line.includes('\x1b[35m████████'), `expected custom usage warning color, got: ${JSON.stringify(line)}`);
  assert.ok(line.includes('\x1b[35m80%\x1b[0m'), `expected custom usage warning percentage color, got: ${JSON.stringify(line)}`);
});

test('renderSessionLine hides usage when showUsage config is false (hybrid toggle)', () => {
  const ctx = baseContext();
  ctx.usageData = {
    planName: 'Pro',
    fiveHour: 25,
    sevenDay: 10,
    fiveHourResetAt: null,
    sevenDayResetAt: null,
  };
  // Even with usageData present, setting showUsage to false should hide it
  ctx.config.display.showUsage = false;
  const line = renderSessionLine(ctx);
  assert.ok(!line.includes('5h'), 'should not show usage when showUsage is false');
  assert.ok(!line.includes('Pro'), 'should not show plan name when showUsage is false');
});

test('renderSessionLine uses buffered percent when autocompactBuffer is enabled', () => {
  const ctx = baseContext();
  // 60000 tokens / 200000 = 30% raw, scale = (0.30 - 0.05) / (0.50 - 0.05) ≈ 0.556
  // buffer = 200000 * 0.165 * 0.556 ≈ 18333, (60000 + 18333) / 200000 = 39.2% → 39%
  ctx.stdin.context_window.current_usage.input_tokens = 60000;
  ctx.config.display.autocompactBuffer = 'enabled';
  const line = renderSessionLine(ctx);
  // Should show 39% (buffered), not 30% (raw)
  assert.ok(line.includes('39%'), `expected buffered percent 39%, got: ${line}`);
});

test('renderSessionLine uses raw percent when autocompactBuffer is disabled', () => {
  const ctx = baseContext();
  // 60000 tokens / 200000 = 30% raw
  ctx.stdin.context_window.current_usage.input_tokens = 60000;
  ctx.config.display.autocompactBuffer = 'disabled';
  const line = renderSessionLine(ctx);
  // Should show 30% (raw), not 39% (buffered)
  assert.ok(line.includes('30%'), `expected raw percent 30%, got: ${line}`);
});

test('renderSessionLine avoids inflated startup percentage before native context data exists', () => {
  const ctx = baseContext();
  ctx.stdin.context_window.current_usage = {};
  ctx.stdin.context_window.used_percentage = null;
  ctx.config.display.autocompactBuffer = 'enabled';

  const line = renderSessionLine(ctx);

  assert.ok(line.includes('0%'), `expected startup percent 0%, got: ${line}`);
});

test('render adds separator line when showSeparators is true and activity exists', () => {
  const ctx = baseContext();
  ctx.config.showSeparators = true;
  ctx.transcript.tools = [
    { id: 'tool-1', name: 'Read', status: 'completed', startTime: new Date(0), endTime: new Date(0), duration: 0 },
  ];

  const logs = [];
  const originalLog = console.log;
  console.log = (line) => logs.push(line);
  try {
    render(ctx);
  } finally {
    console.log = originalLog;
  }

  assert.ok(logs.length > 1, 'should render multiple lines');
  assert.ok(logs.some(l => l.includes('─')), 'should include separator line');
});

test('render omits separator when showSeparators is true but no activity', () => {
  const ctx = baseContext();
  ctx.config.showSeparators = true;

  const logs = [];
  const originalLog = console.log;
  console.log = (line) => logs.push(line);
  try {
    render(ctx);
  } finally {
    console.log = originalLog;
  }

  assert.ok(!logs.some(l => l.includes('─')), 'should not include separator');
});

test('render preserves regular spaces instead of non-breaking spaces', () => {
  const ctx = baseContext();
  ctx.config.lineLayout = 'expanded';

  const logs = [];
  const originalLog = console.log;
  console.log = (line) => logs.push(line);
  try {
    render(ctx);
  } finally {
    console.log = originalLog;
  }

  assert.ok(logs.length > 0, 'should render at least one line');
  assert.ok(logs.every(line => !line.includes('\u00A0')), 'output should not include non-breaking spaces');
});

// fileStats tests
test('renderSessionLine displays file stats when showFileStats is true', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '/tmp/my-project';
  ctx.config.gitStatus.showFileStats = true;
  ctx.gitStatus = {
    branch: 'main',
    isDirty: true,
    ahead: 0,
    behind: 0,
    fileStats: { modified: 2, added: 1, deleted: 0, untracked: 3 },
  };
  const line = renderSessionLine(ctx);
  assert.ok(line.includes('!2'), 'expected modified count');
  assert.ok(line.includes('+1'), 'expected added count');
  assert.ok(line.includes('?3'), 'expected untracked count');
  assert.ok(!line.includes('✘'), 'should not show deleted when 0');
});

test('renderSessionLine omits file stats when showFileStats is false', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '/tmp/my-project';
  ctx.config.gitStatus.showFileStats = false;
  ctx.gitStatus = {
    branch: 'main',
    isDirty: true,
    ahead: 0,
    behind: 0,
    fileStats: { modified: 2, added: 1, deleted: 0, untracked: 3 },
  };
  const line = renderSessionLine(ctx);
  assert.ok(!line.includes('!2'), 'should not show modified count');
  assert.ok(!line.includes('+1'), 'should not show added count');
});

test('renderSessionLine handles missing showFileStats config (backward compatibility)', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '/tmp/my-project';
  // Simulate old config without showFileStats
  delete ctx.config.gitStatus.showFileStats;
  ctx.gitStatus = {
    branch: 'main',
    isDirty: true,
    ahead: 0,
    behind: 0,
    fileStats: { modified: 2, added: 1, deleted: 0, untracked: 3 },
  };
  // Should not crash and should not show file stats (default is false)
  const line = renderSessionLine(ctx);
  assert.ok(line.includes('git:('), 'should still show git info');
  assert.ok(!line.includes('!2'), 'should not show file stats when config missing');
});

test('renderSessionLine combines showFileStats with showDirty and showAheadBehind', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '/tmp/my-project';
  ctx.config.gitStatus = {
    enabled: true,
    showDirty: true,
    showAheadBehind: true,
    showFileStats: true,
    pushWarningThreshold: 0,
    pushCriticalThreshold: 0,
  };
  ctx.gitStatus = {
    branch: 'feature',
    isDirty: true,
    ahead: 2,
    behind: 1,
    fileStats: { modified: 3, added: 0, deleted: 1, untracked: 0 },
  };
  const line = renderSessionLine(ctx);
  assert.ok(line.includes('feature'), 'expected branch name');
  assert.ok(line.includes('*'), 'expected dirty indicator');
  assert.ok(line.includes('↑2'), 'expected ahead count');
  assert.ok(line.includes('↓1'), 'expected behind count');
  assert.ok(line.includes('!3'), 'expected modified count');
  assert.ok(line.includes('✘1'), 'expected deleted count');
});

test('renderProjectLine colors ahead count at warning threshold', () => {
  const ctx = baseContext();
  ctx.config.gitStatus = {
    enabled: true,
    showDirty: true,
    showAheadBehind: true,
    showFileStats: false,
    pushWarningThreshold: 10,
    pushCriticalThreshold: 20,
  };
  ctx.gitStatus = { branch: 'main', isDirty: false, ahead: 12, behind: 0 };

  const line = renderProjectLine(ctx);
  assert.ok(line?.includes('\x1b[33m↑12\x1b[0m'), 'ahead count should use warning color');
});

test('renderProjectLine colors ahead count at critical threshold', () => {
  const ctx = baseContext();
  ctx.config.gitStatus = {
    enabled: true,
    showDirty: true,
    showAheadBehind: true,
    showFileStats: false,
    pushWarningThreshold: 10,
    pushCriticalThreshold: 20,
  };
  ctx.gitStatus = { branch: 'main', isDirty: false, ahead: 25, behind: 0 };

  const line = renderProjectLine(ctx);
  assert.ok(line?.includes('\x1b[31m↑25\x1b[0m'), 'ahead count should use critical color');
});

test('renderProjectLine strips control characters from project and branch links', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '/tmp/my-\u0007project';
  ctx.gitStatus = {
    branch: 'feat/\u0007name',
    isDirty: false,
    ahead: 0,
    behind: 0,
    branchUrl: 'https://github.com/example/claude-hud/tree/feat%2Fname\u0007',
  };

  const line = renderProjectLine(ctx) ?? '';
  const visible = stripAnsi(line);

  assert.ok(visible.includes('my-project'));
  assert.ok(visible.includes('feat/name'));
  assert.ok(!line.includes('\u0007'));
});

test('renderGitFilesLine renders tracked files with per-file line diffs', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '/tmp/my-project';
  ctx.config.gitStatus.showFileStats = true;
  ctx.gitStatus = {
    branch: 'main',
    isDirty: true,
    ahead: 0,
    behind: 0,
    lineDiff: { added: 5, deleted: 2 },
    fileStats: {
      modified: 1,
      added: 1,
      deleted: 0,
      untracked: 2,
      trackedFiles: [
        { basename: 'app.ts', fullPath: 'src/app.ts', type: 'modified', lineDiff: { added: 4, deleted: 2 } },
        { basename: 'new.ts', fullPath: 'src/new.ts', type: 'added', lineDiff: { added: 1, deleted: 0 } },
      ],
    },
  };

  const line = renderGitFilesLine(ctx, 120);
  assert.ok(line?.includes('app.ts'));
  assert.ok(line?.includes('new.ts'));
  assert.ok(line?.includes('+4'));
  assert.ok(line?.includes('-2'));
  assert.ok(line?.includes('?2'));
});

test('renderGitFilesLine strips control characters and skips links outside cwd', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '/tmp/my-project';
  ctx.config.gitStatus.showFileStats = true;
  ctx.gitStatus = {
    branch: 'main',
    isDirty: true,
    ahead: 0,
    behind: 0,
    lineDiff: { added: 1, deleted: 0 },
    fileStats: {
      modified: 1,
      added: 0,
      deleted: 0,
      untracked: 0,
      trackedFiles: [
        { basename: 'app\u0007.ts', fullPath: '../outside.ts', type: 'modified', lineDiff: { added: 1, deleted: 0 } },
      ],
    },
  };

  const line = renderGitFilesLine(ctx, 120) ?? '';
  const visible = stripAnsi(line);

  assert.ok(visible.includes('app.ts'));
  assert.ok(!line.includes('\u0007'));
});

test('renderGitFilesLine hides on narrow terminals', () => {
  const ctx = baseContext();
  ctx.config.gitStatus.showFileStats = true;
  ctx.gitStatus = {
    branch: 'main',
    isDirty: true,
    ahead: 0,
    behind: 0,
    lineDiff: { added: 1, deleted: 0 },
    fileStats: {
      modified: 1,
      added: 0,
      deleted: 0,
      untracked: 0,
      trackedFiles: [
        { basename: 'app.ts', fullPath: 'src/app.ts', type: 'modified', lineDiff: { added: 1, deleted: 0 } },
      ],
    },
  };

  assert.equal(renderGitFilesLine(ctx, 50), null);
});

test('render expanded layout honors custom elementOrder including activity placement', () => {
  const ctx = baseContext();
  ctx.config.lineLayout = 'expanded';
  ctx.stdin.cwd = '/tmp/my-project';
  ctx.usageData = {
    planName: 'Team',
    fiveHour: 30,
    sevenDay: 10,
    fiveHourResetAt: new Date(Date.now() + 60 * 60 * 1000),
    sevenDayResetAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  };
  ctx.memoryUsage = {
    totalBytes: 16 * 1024 ** 3,
    usedBytes: 10 * 1024 ** 3,
    freeBytes: 6 * 1024 ** 3,
    usedPercent: 63,
  };
  ctx.claudeMdCount = 1;
  ctx.rulesCount = 2;
  ctx.transcript.tools = [
    { id: 'tool-1', name: 'Read', status: 'completed', startTime: new Date(0), endTime: new Date(0), duration: 0 },
  ];
  ctx.transcript.agents = [
    { id: 'agent-1', type: 'planner', status: 'running', startTime: new Date(0) },
  ];
  ctx.transcript.todos = [
    { content: 'todo-marker', status: 'in_progress' },
  ];
  ctx.config.display.showMemoryUsage = true;
  ctx.config.elementOrder = ['tools', 'project', 'usage', 'context', 'memory', 'environment', 'agents', 'todos'];

  const lines = withTerminal(120, () => captureRenderLines(ctx));
  const toolIndex = lines.findIndex(line => line.includes('Read'));
  const projectIndex = lines.findIndex(line => line.includes('my-project'));
  const combinedIndex = lines.findIndex(line => line.includes('Usage') && line.includes('Context'));
  const memoryIndex = lines.findIndex(line => line.includes('Approx RAM'));
  const environmentIndex = lines.findIndex(line => line.includes('CLAUDE.md'));
  const agentIndex = lines.findIndex(line => line.includes('planner'));
  const todoIndex = lines.findIndex(line => line.includes('todo-marker'));

  assert.deepEqual(
    [toolIndex, projectIndex, combinedIndex, memoryIndex, environmentIndex, agentIndex, todoIndex].every(index => index >= 0),
    true,
    'expected all configured elements to render'
  );
  assert.ok(toolIndex < projectIndex, 'tool line should move ahead of project');
  assert.ok(projectIndex < combinedIndex, 'combined usage/context line should follow project');
  assert.ok(combinedIndex < memoryIndex, 'memory line should follow combined usage/context');
  assert.ok(memoryIndex < environmentIndex, 'environment line should follow memory');
  assert.ok(environmentIndex < agentIndex, 'agent line should follow environment');
  assert.ok(agentIndex < todoIndex, 'todo line should follow agent line');
});

test('render expanded layout omits elements not present in elementOrder', () => {
  const ctx = baseContext();
  ctx.config.lineLayout = 'expanded';
  ctx.stdin.cwd = '/tmp/my-project';
  ctx.usageData = {
    planName: 'Team',
    fiveHour: 30,
    sevenDay: 10,
    fiveHourResetAt: new Date(Date.now() + 60 * 60 * 1000),
    sevenDayResetAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  };
  ctx.memoryUsage = {
    totalBytes: 16 * 1024 ** 3,
    usedBytes: 10 * 1024 ** 3,
    freeBytes: 6 * 1024 ** 3,
    usedPercent: 63,
  };
  ctx.claudeMdCount = 1;
  ctx.transcript.tools = [
    { id: 'tool-1', name: 'Read', status: 'completed', startTime: new Date(0), endTime: new Date(0), duration: 0 },
  ];
  ctx.transcript.agents = [
    { id: 'agent-1', type: 'planner', status: 'running', startTime: new Date(0) },
  ];
  ctx.transcript.todos = [
    { content: 'todo-marker', status: 'in_progress' },
  ];
  ctx.config.elementOrder = ['project', 'tools'];
  ctx.config.display.showMemoryUsage = true;

  const output = captureRenderLines(ctx).join('\n');

  assert.ok(output.includes('my-project'), 'project should render when included');
  assert.ok(output.includes('Read'), 'tools should render when included');
  assert.ok(!output.includes('Context'), 'context should be omitted when excluded');
  assert.ok(!output.includes('Usage'), 'usage should be omitted when excluded');
  assert.ok(!output.includes('Approx RAM'), 'memory should be omitted when excluded');
  assert.ok(!output.includes('CLAUDE.md'), 'environment should be omitted when excluded');
  assert.ok(!output.includes('planner'), 'agents should be omitted when excluded');
  assert.ok(!output.includes('todo-marker'), 'todos should be omitted when excluded');
});

test('render expanded layout combines default merge-group elements when adjacent in elementOrder', () => {
  const ctx = baseContext();
  ctx.config.lineLayout = 'expanded';
  ctx.usageData = {
    planName: 'Team',
    fiveHour: 30,
    sevenDay: 10,
    fiveHourResetAt: new Date(Date.now() + 60 * 60 * 1000),
    sevenDayResetAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  };
  ctx.config.elementOrder = ['usage', 'context'];

  const lines = withTerminal(120, () => captureRenderLines(ctx));

  assert.equal(lines.length, 1, 'adjacent usage and context should share one expanded line');
  assert.ok(lines[0].includes('Usage'), 'combined line should include usage');
  assert.ok(lines[0].includes('Context'), 'combined line should include context');
  assert.ok(lines[0].includes('│'), 'combined line should preserve the shared separator');
  const stripped = stripAnsi(lines[0]);
  assert.ok(stripped.includes('Usage 5h 30%'), `combined line should keep the default unpadded usage label: ${stripped}`);
  assert.ok(!stripped.includes('Usage  5h 30%'), `combined line should not pad the usage label: ${stripped}`);
  assert.ok(!stripped.includes('Weekly '), `combined line should not pad the weekly label: ${stripped}`);
});

test('render expanded layout keeps merge-group elements separate when they are not adjacent', () => {
  const ctx = baseContext();
  ctx.config.lineLayout = 'expanded';
  ctx.stdin.cwd = '/tmp/my-project';
  ctx.usageData = {
    planName: 'Team',
    fiveHour: 30,
    sevenDay: 10,
    fiveHourResetAt: new Date(Date.now() + 60 * 60 * 1000),
    sevenDayResetAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  };
  ctx.config.elementOrder = ['usage', 'project', 'context'];

  const lines = captureRenderLines(ctx);
  const usageLine = lines.find(line => line.includes('Usage'));
  const contextLine = lines.find(line => line.includes('Context'));
  const combinedLine = lines.find(line => line.includes('Usage') && line.includes('Context'));

  assert.ok(usageLine, 'usage should render on its own line');
  assert.ok(contextLine, 'context should render on its own line');
  assert.equal(combinedLine, undefined, 'usage and context should not combine when separated by another element');
});

test('render expanded layout keeps default merge-group elements separate when mergeGroups is empty', () => {
  const ctx = baseContext();
  ctx.config.lineLayout = 'expanded';
  ctx.usageData = {
    planName: 'Team',
    fiveHour: 30,
    sevenDay: 10,
    fiveHourResetAt: new Date(Date.now() + 60 * 60 * 1000),
    sevenDayResetAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  };
  ctx.config.display.mergeGroups = [];
  ctx.config.elementOrder = ['usage', 'context'];

  const lines = withTerminal(120, () => captureRenderLines(ctx));

  assert.equal(lines.length, 2, 'empty mergeGroups should disable expanded merged lines');
  assert.ok(lines.some(line => line.includes('Usage')), 'usage should stay visible');
  assert.ok(lines.some(line => line.includes('Context')), 'context should stay visible');
  assert.ok(!lines.some(line => line.includes('Usage') && line.includes('Context')), 'no combined line should be rendered');
});

test('render expanded layout combines custom merge groups in configured order', () => {
  const ctx = baseContext();
  ctx.config.lineLayout = 'expanded';
  ctx.stdin.cwd = '/tmp/my-project';
  ctx.usageData = {
    planName: 'Team',
    fiveHour: 30,
    sevenDay: 10,
    fiveHourResetAt: new Date(Date.now() + 60 * 60 * 1000),
    sevenDayResetAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  };
  ctx.config.display.mergeGroups = [['project', 'usage', 'context']];
  ctx.config.elementOrder = ['project', 'usage', 'context'];

  const lines = withTerminal(160, () => captureRenderLines(ctx));

  assert.equal(lines.length, 1, 'custom merge groups should combine all adjacent configured elements');
  assert.ok(lines[0].includes('my-project'), 'combined line should include project');
  assert.ok(lines[0].includes('Usage'), 'combined line should include usage');
  assert.ok(lines[0].includes('Context'), 'combined line should include context');
  assert.ok(lines[0].split('│').length - 1 >= 2, 'combined line should keep the merge separators');
});

test('render expanded layout aligns progress labels only after wrapping merged lines to separate lines', () => {
  const ctx = baseContext();
  ctx.config.lineLayout = 'expanded';
  ctx.usageData = {
    planName: 'Team',
    fiveHour: 45,
    sevenDay: 85,
    fiveHourResetAt: new Date(Date.now() + 90 * 60 * 1000),
    sevenDayResetAt: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000),
  };
  ctx.config.elementOrder = ['usage', 'context'];

  const lines = withTerminal(24, () => captureRenderLines(ctx)).map(stripAnsi);
  const usageLine = lines.find((line) => line.includes('Usage'));
  const contextLine = lines.find((line) => line.includes('Context'));
  const weeklyLine = lines.find((line) => line.includes('Weekly'));

  assert.ok(usageLine, `narrow terminals should keep the usage line visible: ${lines.join(' | ')}`);
  assert.ok(contextLine, `narrow terminals should keep the context line visible: ${lines.join(' | ')}`);
  assert.ok(weeklyLine, `narrow terminals should keep the weekly segment visible: ${lines.join(' | ')}`);
  assert.ok(usageLine.startsWith('Usage  '), `usage line should pad its label when stacked: ${usageLine}`);
  assert.ok(weeklyLine.startsWith('Weekly '), `weekly label should pad when stacked: ${weeklyLine}`);
  assert.ok(contextLine.startsWith('Context'), `context line should stay aligned with the padded usage label: ${contextLine}`);
});

test('render compact layout keeps activity lines even when elementOrder omits them', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '/tmp/my-project';
  ctx.transcript.tools = [
    { id: 'tool-1', name: 'Read', status: 'completed', startTime: new Date(0), endTime: new Date(0), duration: 0 },
  ];
  ctx.transcript.todos = [
    { content: 'todo-marker', status: 'in_progress' },
  ];
  ctx.config.elementOrder = ['project'];

  const output = captureRenderLines(ctx).join('\n');

  assert.ok(output.includes('Read'), 'compact mode should keep tools visible');
  assert.ok(output.includes('todo-marker'), 'compact mode should keep todos visible');
});

test('renderSessionTokensLine returns null when session token display is disabled', () => {
  const ctx = baseContext();
  ctx.transcript.sessionTokens = {
    inputTokens: 1000,
    outputTokens: 200,
    cacheCreationTokens: 3000,
    cacheReadTokens: 400,
  };

  assert.equal(renderSessionTokensLine(ctx), null);
});

test('renderSessionTokensLine renders cumulative session token totals', () => {
  const ctx = baseContext();
  ctx.config.display.showSessionTokens = true;
  ctx.transcript.sessionTokens = {
    inputTokens: 7000,
    outputTokens: 28000,
    cacheCreationTokens: 12800000,
    cacheReadTokens: 0,
  };

  const line = stripAnsi(renderSessionTokensLine(ctx) ?? '');
  assert.equal(line, 'Tokens 12.8M (in: 7k, out: 28k, cache: 12.8M)');
});

test('renderSessionLine includes compact session token summary when enabled', () => {
  const ctx = baseContext();
  ctx.config.display.showSessionTokens = true;
  ctx.transcript.sessionTokens = {
    inputTokens: 1500,
    outputTokens: 250,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
  };

  const line = stripAnsi(renderSessionLine(ctx));
  assert.ok(line.includes('tok: 2k (in: 2k, out: 250)'), 'should include compact token summary');
});

test('renderSessionLine translates compact session token summary when Chinese is enabled', () => {
  const ctx = baseContext();
  ctx.config.display.showSessionTokens = true;
  ctx.transcript.sessionTokens = {
    inputTokens: 1500,
    outputTokens: 250,
    cacheCreationTokens: 500,
    cacheReadTokens: 0,
  };

  setLanguage('zh');
  try {
    const line = stripAnsi(renderSessionLine(ctx));
    assert.ok(line.includes('令牌: 2k (输入: 2k, 输出: 250)'), `unexpected zh compact token summary: ${line}`);
    assert.ok(!line.includes('tok:'), `unexpected bare English token label in zh output: ${line}`);
    assert.ok(!line.includes('in:'), `unexpected bare English input label in zh output: ${line}`);
    assert.ok(!line.includes('out:'), `unexpected bare English output label in zh output: ${line}`);
  } finally {
    setLanguage('en');
  }
});

// ---------------------------------------------------------------------------
// display.timeFormat — absolute and both modes
// ---------------------------------------------------------------------------

test('renderUsageLine uses "resets in" preposition for default relative mode in bar-mode', () => {
  const ctx = baseContext();
  ctx.config.display.usageBarEnabled = true;
  ctx.usageData = {
    planName: 'Pro',
    fiveHour: 45,
    sevenDay: 20,
    fiveHourResetAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    sevenDayResetAt: null,
  };
  const plain = stripAnsi(renderUsageLine(ctx));
  assert.ok(plain.includes('resets in'), `should use "resets in" for relative mode, got: ${plain}`);
});

test('renderUsageLine uses "resets at" when timeFormat is "absolute" (bar mode)', () => {
  const ctx = baseContext();
  ctx.config.display.usageBarEnabled = true;
  ctx.config.display.timeFormat = 'absolute';
  ctx.usageData = {
    planName: 'Pro',
    fiveHour: 45,
    sevenDay: 20,
    fiveHourResetAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    sevenDayResetAt: null,
  };
  const plain = stripAnsi(renderUsageLine(ctx));
  assert.ok(plain.includes('resets at'), `expected "resets at" in absolute bar mode, got: ${plain}`);
  assert.ok(!plain.includes('resets in'), `should not say "resets in" for absolute mode, got: ${plain}`);
});

test('renderUsageLine shows relative and absolute time when timeFormat is "both"', () => {
  const ctx = baseContext();
  ctx.config.display.usageBarEnabled = false;
  ctx.config.display.timeFormat = 'both';
  ctx.usageData = {
    planName: 'Pro',
    fiveHour: 45,
    sevenDay: 20,
    fiveHourResetAt: new Date(Date.now() + 2 * 60 * 60 * 1000 + 30 * 60 * 1000),
    sevenDayResetAt: null,
  };
  const plain = stripAnsi(renderUsageLine(ctx));
  // "both" produces "Xh Ym, at HH:MM" — must contain relative part and " at " from i18n
  assert.match(plain, /\dh/, 'should contain relative duration hours');
  assert.ok(plain.includes(' at '), `should contain absolute "at" prefix, got: ${plain}`);
  assert.ok(plain.includes('resets in'), `should use "resets in" preposition for both mode, got: ${plain}`);
});

test('renderUsageLine limit-reached uses "resets in" for default relative mode', () => {
  const ctx = baseContext();
  ctx.usageData = {
    planName: 'Pro',
    fiveHour: 100,
    sevenDay: 45,
    fiveHourResetAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    sevenDayResetAt: null,
  };
  const plain = stripAnsi(renderUsageLine(ctx));
  assert.ok(plain.includes('Limit reached'), 'should show limit reached');
  assert.ok(plain.includes('resets in'), `should use "resets in" preposition for relative mode, got: ${plain}`);
});

test('renderUsageLine limit-reached uses "resets at" for absolute timeFormat', () => {
  const ctx = baseContext();
  ctx.config.display.timeFormat = 'absolute';
  ctx.usageData = {
    planName: 'Pro',
    fiveHour: 100,
    sevenDay: 45,
    fiveHourResetAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    sevenDayResetAt: null,
  };
  const plain = stripAnsi(renderUsageLine(ctx));
  assert.ok(plain.includes('Limit reached'), 'should show limit reached');
  assert.ok(plain.includes('resets at'), `should use "resets at" for absolute mode, got: ${plain}`);
  assert.ok(!plain.includes('resets in'), `should not say "resets in" for absolute mode, got: ${plain}`);
});
