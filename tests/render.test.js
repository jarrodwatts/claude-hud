import { test } from 'node:test';
import assert from 'node:assert/strict';
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
    gitBranch: null,
    config: {
      pathLevels: 1,
      gitStatus: { enabled: true },
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

test('renderSessionLine displays 1 path segment by default', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '/Users/jarrod/dev/apps/my-project';
  const line = renderSessionLine(ctx);
  assert.ok(line.includes('my-project'), 'expected last 1 segment');
  assert.ok(!line.includes('apps/my-project'), 'should not include 2 segments');
});

test('renderSessionLine displays 2 path segments when configured', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '/Users/jarrod/dev/apps/my-project';
  ctx.config.pathLevels = 2;
  const line = renderSessionLine(ctx);
  assert.ok(line.includes('apps/my-project'), 'expected last 2 segments');
  assert.ok(!line.includes('dev/apps'), 'should not include 3 segments');
});

test('renderSessionLine displays 3 path segments when configured', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '/Users/jarrod/dev/apps/my-project';
  ctx.config.pathLevels = 3;
  const line = renderSessionLine(ctx);
  assert.ok(line.includes('dev/apps/my-project'), 'expected last 3 segments');
  assert.ok(!line.includes('/Users'), 'should not include full path');
});

test('renderSessionLine handles short paths gracefully', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '/home/user';
  ctx.config.pathLevels = 3;
  const line = renderSessionLine(ctx);
  assert.ok(line.includes('home/user'), 'expected available segments');
});

test('renderSessionLine handles root path gracefully', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '/';
  const line = renderSessionLine(ctx);
  assert.ok(line.includes('[Opus]'));
});

// Cross-platform path tests
test('renderSessionLine handles Windows paths with backslashes', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = 'C:\\Users\\jarrod\\dev\\my-project';
  ctx.config.pathLevels = 1;
  const line = renderSessionLine(ctx);
  assert.ok(line.includes('my-project'), 'expected last segment from Windows path');
  assert.ok(!line.includes('\\'), 'should not contain backslashes in output');
});

test('renderSessionLine handles Windows paths with 2 levels', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = 'C:\\Users\\jarrod\\dev\\my-project';
  ctx.config.pathLevels = 2;
  const line = renderSessionLine(ctx);
  assert.ok(line.includes('dev/my-project'), 'expected 2 segments with forward slash');
});

test('renderSessionLine handles Windows paths with 3 levels', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = 'C:\\Users\\jarrod\\dev\\my-project';
  ctx.config.pathLevels = 3;
  const line = renderSessionLine(ctx);
  assert.ok(line.includes('jarrod/dev/my-project'), 'expected 3 segments with forward slashes');
});

test('renderSessionLine handles mixed path separators', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = 'C:\\Users/jarrod\\dev/my-project';
  ctx.config.pathLevels = 2;
  const line = renderSessionLine(ctx);
  assert.ok(line.includes('dev/my-project'), 'expected correct parsing of mixed separators');
});

test('renderSessionLine handles UNC paths', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '\\\\server\\share\\folder\\project';
  ctx.config.pathLevels = 2;
  const line = renderSessionLine(ctx);
  assert.ok(line.includes('folder/project'), 'expected 2 segments from UNC path');
});

test('renderSessionLine output always uses forward slashes', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = 'D:\\Projects\\client\\webapp';
  ctx.config.pathLevels = 3;
  const line = renderSessionLine(ctx);
  assert.ok(line.includes('Projects/client/webapp'), 'expected forward slashes in output');
  assert.ok(!line.includes('\\'), 'output should never contain backslashes');
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
  ctx.gitBranch = 'main';
  const line = renderSessionLine(ctx);
  assert.ok(line.includes('git:('));
  assert.ok(line.includes('main'));
});

test('renderSessionLine omits git branch when null', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '/tmp/my-project';
  ctx.gitBranch = null;
  const line = renderSessionLine(ctx);
  assert.ok(!line.includes('git:('));
});

test('renderSessionLine displays branch with slashes', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '/tmp/my-project';
  ctx.gitBranch = 'feature/add-auth';
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

// Cross-platform tool path tests
test('renderToolsLine handles Windows paths with backslashes', () => {
  const ctx = baseContext();
  ctx.transcript.tools = [
    {
      id: 'tool-1',
      name: 'Edit',
      target: 'C:\\Users\\jarrod\\dev\\my-project\\auth.ts',
      status: 'running',
      startTime: new Date(0),
    },
  ];

  const line = renderToolsLine(ctx);
  assert.ok(line?.includes('auth.ts'), 'expected filename from Windows path');
  assert.ok(!line?.includes('\\'), 'should not contain backslashes');
});

test('renderToolsLine truncates long Windows paths correctly', () => {
  const ctx = baseContext();
  ctx.transcript.tools = [
    {
      id: 'tool-1',
      name: 'Read',
      target: 'C:\\Users\\jarrod\\very\\long\\path\\to\\file.ts',
      status: 'running',
      startTime: new Date(0),
    },
  ];

  const line = renderToolsLine(ctx);
  assert.ok(line?.includes('.../file.ts'), 'expected truncated Windows path');
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

// Configuration tests
test('renderSessionLine hides git branch when gitStatus.enabled is false', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '/tmp/my-project';
  ctx.gitBranch = 'main';
  ctx.config.gitStatus.enabled = false;
  const line = renderSessionLine(ctx);
  assert.ok(!line.includes('git:('), 'git branch should be hidden');
  assert.ok(!line.includes('main'), 'branch name should not appear');
});

test('renderSessionLine shows git branch when gitStatus.enabled is true', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '/tmp/my-project';
  ctx.gitBranch = 'main';
  ctx.config.gitStatus.enabled = true;
  const line = renderSessionLine(ctx);
  assert.ok(line.includes('git:('), 'git branch should be shown');
  assert.ok(line.includes('main'), 'branch name should appear');
});
