import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { render } from '../dist/render/index.js';
import { renderSessionLine } from '../dist/render/session-line.js';
import { renderProjectLine } from '../dist/render/lines/project.js';
import { renderToolsLine } from '../dist/render/tools-line.js';
import { renderAgentsLine } from '../dist/render/agents-line.js';
import { renderTodosLine } from '../dist/render/todos-line.js';
import { renderUsageLine } from '../dist/render/lines/usage.js';
import { renderMemoryLine } from '../dist/render/lines/memory.js';
import { getContextColor, getQuotaColor } from '../dist/render/colors.js';

function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
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
    transcript: { tools: [], agents: [], todos: [] },
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
      elementOrder: ['project', 'context', 'usage', 'memory', 'environment', 'tools', 'agents', 'todos'],
      gitStatus: { enabled: true, showDirty: true, showAheadBehind: false, showFileStats: false },
      display: { showModel: true, showProject: true, showContextBar: true, contextValue: 'percent', showConfigCounts: true, showDuration: true, showSpeed: false, showTokenBreakdown: true, showUsage: true, usageBarEnabled: false, showTools: true, showAgents: true, showTodos: true, showSessionName: false, showClaudeCodeVersion: false, showMemoryUsage: false, autocompactBuffer: 'enabled', usageThreshold: 0, sevenDayThreshold: 80, environmentThreshold: 0, customLine: '' },
      colors: {
        context: 'green',
        usage: 'brightBlue',
        warning: 'yellow',
        usageWarning: 'brightMagenta',
        critical: 'red',
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

test('renderProjectLine includes duration when showDuration is true', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '/tmp/my-project';
  ctx.config.display.showDuration = true;
  ctx.sessionDuration = '12m 34s';
  const line = renderProjectLine(ctx);
  assert.ok(line?.includes('12m 34s'), 'should include session duration');
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

    const lines = captureRenderLines(ctx);
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

test('renderSessionLine shows API label when API key auth is active', () => {
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
    assert.ok(line.includes('API'), 'should include API label for API key auth');
    assert.ok(!line.includes('Max'), 'should not include subscriber plan label');
  } finally {
    if (savedApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = savedApiKey;
    }
  }
});

test('renderProjectLine shows API label when API key auth is active', () => {
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
    assert.ok(line?.includes('API'), 'should include API label for API key auth');
    assert.ok(!line?.includes('Pro'), 'should not include subscriber plan label');
  } finally {
    if (savedApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = savedApiKey;
    }
  }
});

test('renderSessionLine shows Bedrock label and hides usage for bedrock model ids', () => {
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
  assert.ok(!line.includes('5h:'), 'should hide usage display');
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
  assert.ok(line.includes('5h:'), 'should include 5h label');
  assert.ok(!line.includes('7d:'), 'should NOT include 7d when below 80%');
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
  assert.ok(line.includes('5h:'), 'should include 5h label');
  assert.ok(line.includes('7d:'), 'should include 7d when >= 80%');
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
  assert.ok(line.includes('7d: 85%'), `should include 7d label and percentage: ${line}`);
  assert.ok(line.includes('(1d 4h)'), `should include 7d reset countdown in text-only mode: ${line}`);
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
  assert.ok(line.includes('7d:'), 'should include 7d when threshold is 0');
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
  assert.ok(!line.includes('5h:'), `should not render a ghost 5h section: ${line}`);
  assert.ok(line.includes('7d:'), `should render the weekly window when it is the only usage value: ${line}`);
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
  assert.ok(line.includes('5h:'), 'should include 5h label');
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
  assert.ok(line.includes('5h: 45%'), `should include 5h text-only usage: ${line}`);
  assert.ok(line.includes('7d: 85%'), `should include 7d text-only usage: ${line}`);
  assert.ok(line.includes('(resets in 1d 4h)'), `should include 7d reset countdown in text-only mode: ${line}`);
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
  assert.ok(!line.includes('5h:'), `should not render a ghost 5h section: ${line}`);
  assert.ok(line.includes('7d:'), `should render the weekly window when it is the only usage value: ${line}`);
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
  assert.ok(/resets \d+d( \d+h)?/.test(plain), `expected day/hour reset format, got: ${plain}`);
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
  assert.ok(line.includes('5h:'), 'should include 5h label');
  assert.ok(line.includes('--'), 'should show -- for null values');
});

test('renderSessionLine omits usage when usageData is null', () => {
  const ctx = baseContext();
  ctx.usageData = null;
  const line = renderSessionLine(ctx);
  assert.ok(!line.includes('5h:'), 'should not include 5h label');
  assert.ok(!line.includes('7d:'), 'should not include 7d label');
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

  const line = renderUsageLine(ctx);
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
  assert.ok(!line.includes('5h:'), 'should not show usage when showUsage is false');
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

  const lines = captureRenderLines(ctx);
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

test('render expanded layout combines usage and context when adjacent in elementOrder', () => {
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

  const lines = captureRenderLines(ctx);

  assert.equal(lines.length, 1, 'adjacent usage and context should share one expanded line');
  assert.ok(lines[0].includes('Usage'), 'combined line should include usage');
  assert.ok(lines[0].includes('Context'), 'combined line should include context');
  assert.ok(lines[0].includes('│'), 'combined line should preserve the shared separator');
});

test('render expanded layout keeps usage and context separate when not adjacent', () => {
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
