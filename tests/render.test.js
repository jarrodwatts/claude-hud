import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../dist/render/index.js';
import { renderSessionLine } from '../dist/render/session-line.js';
import { renderToolsLine } from '../dist/render/tools-line.js';
import { renderAgentsLine } from '../dist/render/agents-line.js';
import { renderTodosLine } from '../dist/render/todos-line.js';
import { getContextColor } from '../dist/render/colors.js';

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
      display: { showModel: true, showContextBar: true, showConfigCounts: true, showDuration: true, showTokenBreakdown: true, showUsage: true, showTools: true, showAgents: true, showTodos: true, autocompactBuffer: 'enabled', usageThreshold: 0, environmentThreshold: 0 },
    },
  };
}

test('renderSessionLine adds token breakdown when context is high', () => {
  const ctx = baseContext();
  // For 90%: (tokens + 45000) / 200000 = 0.9 → tokens = 135000
  ctx.stdin.context_window.current_usage.input_tokens = 135000;
  const line = renderSessionLine(ctx);
  assert.ok(line.includes('in:'), 'expected token breakdown');
  assert.ok(line.includes('cache:'), 'expected cache breakdown');
});

test('renderSessionLine includes duration and formats large tokens', () => {
  const ctx = baseContext();
  ctx.sessionDuration = '1m';
  // Use 1M context, need 85%+ to show breakdown
  // For 85%: (tokens + 45000) / 1000000 = 0.85 → tokens = 805000
  ctx.stdin.context_window.context_window_size = 1000000;
  ctx.stdin.context_window.current_usage.input_tokens = 805000;
  ctx.stdin.context_window.current_usage.cache_read_input_tokens = 1500;
  const line = renderSessionLine(ctx);
  assert.ok(line.includes('⏱️'));
  assert.ok(line.includes('805k') || line.includes('805.0k'), 'expected large input token display');
  assert.ok(line.includes('2k'), 'expected cache token display');
});

test('renderSessionLine handles missing input tokens and cache creation usage', () => {
  const ctx = baseContext();
  // For 90%: (tokens + 45000) / 200000 = 0.9 → tokens = 135000 (all from cache)
  ctx.stdin.context_window.context_window_size = 200000;
  ctx.stdin.context_window.current_usage = {
    cache_creation_input_tokens: 135000,
  };
  const line = renderSessionLine(ctx);
  assert.ok(line.includes('90%'));
  assert.ok(line.includes('in: 0'));
});

test('renderSessionLine handles missing cache token fields', () => {
  const ctx = baseContext();
  // For 90%: (tokens + 45000) / 200000 = 0.9 → tokens = 135000
  ctx.stdin.context_window.context_window_size = 200000;
  ctx.stdin.context_window.current_usage = {
    input_tokens: 135000,
  };
  const line = renderSessionLine(ctx);
  assert.ok(line.includes('cache: 0'));
});

test('getContextColor returns yellow for warning threshold', () => {
  assert.equal(getContextColor(70), '\x1b[33m');
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

test('renderSessionLine omits project name when cwd is undefined', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = undefined;
  const line = renderSessionLine(ctx);
  assert.ok(line.includes('[Opus]'));
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
test('renderSessionLine displays plan name in model bracket', () => {
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
  assert.ok(line.includes('Max'), 'should include plan name');
});

test('renderSessionLine displays usage percentages (7d hidden when low)', () => {
  const ctx = baseContext();
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

test('renderSessionLine displays warning when API is unavailable', () => {
  const ctx = baseContext();
  ctx.usageData = {
    planName: 'Max',
    fiveHour: null,
    sevenDay: null,
    fiveHourResetAt: null,
    sevenDayResetAt: null,
    apiUnavailable: true,
  };
  const line = renderSessionLine(ctx);
  assert.ok(line.includes('usage:'), 'should show usage label');
  assert.ok(line.includes('⚠'), 'should show warning indicator');
  assert.ok(!line.includes('5h:'), 'should not show 5h when API unavailable');
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
  // 10000 tokens / 200000 = 5% raw, + 22.5% buffer = 28% buffered (rounded)
  ctx.stdin.context_window.current_usage.input_tokens = 10000;
  ctx.config.display.autocompactBuffer = 'enabled';
  const line = renderSessionLine(ctx);
  // Should show ~28% (buffered), not 5% (raw)
  assert.ok(line.includes('28%'), `expected buffered percent 28%, got: ${line}`);
});

test('renderSessionLine uses raw percent when autocompactBuffer is disabled', () => {
  const ctx = baseContext();
  // 10000 tokens / 200000 = 5% raw
  ctx.stdin.context_window.current_usage.input_tokens = 10000;
  ctx.config.display.autocompactBuffer = 'disabled';
  const line = renderSessionLine(ctx);
  // Should show 5% (raw), not 28% (buffered)
  assert.ok(line.includes('5%'), `expected raw percent 5%, got: ${line}`);
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

  assert.ok(logs.length >= 2, 'should have at least 2 lines');
  assert.ok(logs.some(l => l.includes('─')), 'should include separator character');
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

  assert.equal(logs.length, 1, 'should only have session line');
  assert.ok(!logs.some(l => l.includes('─')), 'should not include separator');
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

