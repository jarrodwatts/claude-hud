// Behaviour the golden harness can't pin cheaply: visibility rules, fallbacks,
// clock-relative activity, and sanitization. Every case renders through renderLines.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { renderLines } from '../dist/render/index.js';
import { mergeConfig } from '../dist/config.js';
import { setLanguage } from '../dist/i18n/index.js';
import { textWidth } from '../dist/render/ansi.js';

const NOW = new Date(2026, 9, 1, 12, 0).getTime();
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BRIGHT_MAGENTA = '\x1b[95m';

const plain = (s) => s.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
const ago = (ms) => new Date(NOW - ms);
const from = (ms) => new Date(NOW + ms);

function ctx({ config = {}, stdin = {}, transcript = {}, ...rest } = {}) {
  return {
    stdin: {
      model: { display_name: 'Opus' },
      cwd: '/home/u/dev/my-project',
      context_window: { context_window_size: 200000, used_percentage: 45, current_usage: { input_tokens: 90000 } },
      ...stdin,
    },
    transcript: { tools: [], agents: [], todos: [], ...transcript },
    claudeMdCount: 0,
    rulesCount: 0,
    mcpCount: 0,
    hooksCount: 0,
    costTotals: null,
    outputSpeed: null,
    gitStatus: null,
    usageData: null,
    memoryUsage: null,
    extraLabel: null,
    ...rest,
    config: mergeConfig(config),
  };
}

const raw = (c, columns = null) => renderLines(c, columns, NOW);
const lines = (c, columns = null) => raw(c, columns).map(plain);
const usage = (overrides = {}) => ({
  fiveHour: 25,
  sevenDay: 40,
  fiveHourResetAt: from(90 * MINUTE),
  sevenDayResetAt: from(50 * HOUR),
  ...overrides,
});
const fable = (percent = 60) => ({ label: 'Fable', percent, resetAt: from(30 * HOUR) });
const compact = (config = {}) => ({ ...config, lineLayout: 'compact' });

afterEach(() => setLanguage('en'));

test('every line starts with a reset so earlier colour cannot leak in', () => {
  for (const line of raw(ctx({ usageData: usage() }))) assert.ok(line.startsWith('\x1b[0m'), JSON.stringify(line));
});

test('scoped usage windows follow 5h and weekly, with the window length in compact', () => {
  const data = usage({ sevenDay: 85, scopedWindows: [fable()] });
  assert.equal(
    lines(ctx({ usageData: data }))[1],
    'Context █████░░░░░ 45% │ Usage ███░░░░░░░ 25% (resets in 1h 30m) | Weekly █████████░ 85% (resets in 2d 2h) | Fable ██████░░░░ 60% (resets in 1d 6h)',
  );
  assert.equal(
    lines(ctx({ usageData: data, config: compact() }))[0],
    '[Opus] █████░░░░░ 45% | my-project | Usage ███░░░░░░░ 25% (1h 30m / 5h) | Weekly █████████░ 85% (2d 2h / Weekly) | Fable ██████░░░░ 60% (1d 6h / 7d)',
  );
});

test('scoped-only usage leads with the Usage label; hiding scoped windows keeps the balance', () => {
  const scopedOnly = usage({ fiveHour: null, sevenDay: null, scopedWindows: [fable()] });
  assert.equal(lines(ctx({ usageData: scopedOnly }))[1], 'Context █████░░░░░ 45% │ Usage Fable ██████░░░░ 60% (resets in 1d 6h)');

  const hidden = { config: { display: { showModelScopedUsage: false } } };
  assert.equal(lines(ctx({ usageData: scopedOnly, ...hidden }))[1], 'Context █████░░░░░ 45%');
  assert.equal(
    lines(ctx({ usageData: { ...scopedOnly, balanceLabel: '¥6.35' }, ...hidden }))[1],
    'Context █████░░░░░ 45% │ Usage ¥6.35',
  );
  const high = usage({ fiveHour: 10, sevenDay: 10, scopedWindows: [fable(95)] });
  const threshold = { display: { showModelScopedUsage: false, usageThreshold: 50 } };
  assert.equal(lines(ctx({ usageData: high, config: threshold }))[1], 'Context █████░░░░░ 45%', 'a hidden window cannot lift usage over the threshold');
});

test('a reached limit replaces the windows; compact drops the Usage label', () => {
  const data = usage({ fiveHour: 100, balanceLabel: '¥6.35', scopedWindows: [fable()] });
  assert.equal(
    lines(ctx({ usageData: data }))[1],
    'Context █████░░░░░ 45% │ Usage ⚠ Limit reached (resets in 1h 30m) | Fable ██████░░░░ 60% (resets in 1d 6h) | ¥6.35',
  );
  assert.match(lines(ctx({ usageData: data, config: compact() }))[0], /my-project \| ⚠ Limit reached \(resets in 1h 30m\) \| Fable .* \| ¥6\.35$/);
  assert.match(lines(ctx({ usageData: usage({ sevenDay: 100, sevenDayResetAt: null }) }))[1], /Usage ⚠ Limit reached$/);
  assert.match(lines(ctx({ usageData: data, config: { display: { usageCompact: true } } }))[1], /│ ⚠ Limit \(1h 30m\) \| Fable: 60% \(1d 6h\) \| ¥6\.35$/);
});

test('below usageThreshold only a balance remains', () => {
  const config = { display: { usageThreshold: 50 } };
  assert.equal(lines(ctx({ usageData: usage(), config }))[1], 'Context █████░░░░░ 45%');
  assert.equal(lines(ctx({ usageData: usage({ balanceLabel: '¥6.35' }), config }))[1], 'Context █████░░░░░ 45% │ Usage ¥6.35');
  assert.equal(lines(ctx({ usageData: usage({ balanceLabel: '¥6.35' }), config: compact(config) }))[0], '[Opus] █████░░░░░ 45% | my-project | ¥6.35');
  assert.equal(lines(ctx({ usageData: usage(), config: { display: { showUsage: false } } }))[1], 'Context █████░░░░░ 45%');
});

test('weekly-only usage keeps its label in both layouts', () => {
  const data = usage({ fiveHour: null });
  assert.equal(lines(ctx({ usageData: data }))[1], 'Context █████░░░░░ 45% │ Usage Weekly ████░░░░░░ 40% (resets in 2d 2h)');
  assert.match(lines(ctx({ usageData: data, config: compact() }))[0], /my-project \| Weekly ████░░░░░░ 40%/);
});

test('usage pace colours the percent, marks it, and overrides the thresholds', () => {
  const data = usage({ fiveHour: 70, fiveHourResetAt: from(2.5 * HOUR), sevenDay: 50, sevenDayResetAt: from(84 * HOUR) });
  const config = { display: { usagePace: true, usageThreshold: 80 } };
  for (const layout of [{}, compact()]) {
    const line = raw(ctx({ usageData: data, config: { ...config, ...layout } })).join('\n');
    assert.ok(line.includes(`${RED}70%`), 'projected over 100% is red');
    assert.ok(line.includes(`${RED}▲`));
    assert.match(plain(line), /70% ▲.*Weekly.*50% ▲/, 'amber weekly pace surfaces the weekly window');
    assert.ok(line.includes(`${BRIGHT_MAGENTA}50%`));
  }
  assert.equal(lines(ctx({ usageData: data, config: { display: { usageThreshold: 80 } } }))[1], 'Context █████░░░░░ 45%');
});

const memory = { totalBytes: 16 * 2 ** 30, usedBytes: 8 * 2 ** 30, freeBytes: 8 * 2 ** 30, usedPercent: 50 };
const withMemory = { display: { showMemoryUsage: true }, elementOrder: ['project', 'context', 'usage', 'memory'] };

test('a visible memory bar widens the other bar labels to match', () => {
  const data = usage({ sevenDay: 85 });
  assert.deepEqual(lines(ctx({ usageData: data, memoryUsage: memory, config: withMemory })).slice(1), [
    'Context    █████░░░░░ 45% │ Usage      ███░░░░░░░ 25% (resets in 1h 30m) | Weekly     █████████░ 85% (resets in 2d 2h)',
    'Approx RAM █████░░░░░ 8.0 GB / 16 GB (50%)',
  ]);
  assert.equal(lines(ctx({ usageData: data, config: withMemory }))[1].slice(0, 9), 'Context █');
  assert.equal(lines(ctx({ usageData: data, memoryUsage: memory, config: compact(withMemory) })).length, 1, 'memory is expanded-only');
});

test('a merged row that does not fit stacks with aligned labels', () => {
  assert.deepEqual(lines(ctx({ usageData: usage({ sevenDay: 85 }), memoryUsage: memory, config: withMemory }), 60).slice(1), [
    'Context    ███░░░ 45%',
    'Usage      ██░░░░ 25% (resets in 1h 30m)',
    'Weekly     █████░ 85% (resets in 2d 2h)',
    'Approx RAM ███░░░ 8.0 GB / 16 GB (50%)',
  ]);
  assert.deepEqual(lines(ctx({ usageData: usage() }), 50).slice(1), ['Context ██░░ 45%', 'Usage   █░░░ 25% (resets in 1h 30m)']);
  setLanguage('zh-Hans');
  const stacked = lines(ctx({ usageData: usage({ sevenDay: 85 }), memoryUsage: memory, config: withMemory }), 60).slice(1);
  const barColumns = stacked.map((line) => textWidth(line.slice(0, line.search(/[█░]/))));
  assert.equal(new Set(barColumns).size, 1, `CJK labels pad by cell width: ${stacked.join(' / ')}`);
});

test('rightAlign pushes the rest of a merged row flush right', () => {
  const config = { display: { rightAlign: ['usage'] } };
  const [, row] = lines(ctx({ usageData: usage(), config }), 100);
  assert.equal(row.length, 100);
  assert.match(row, /^Context █████░░░░░ 45% {2,}Usage ███░░░░░░░ 25% \(resets in 1h 30m\)$/);
  const unaligned = 'Context █████░░░░░ 45% │ Usage ███░░░░░░░ 25% (resets in 1h 30m)';
  assert.equal(lines(ctx({ usageData: usage(), config }))[1], unaligned, 'no width, no alignment');
  assert.equal(lines(ctx({ usageData: usage(), config: { display: { rightAlign: ['context'] } } }), 100)[1], unaligned, 'nothing precedes it');
});

test('project paths keep the configured trailing segments on POSIX and Windows', () => {
  const project = (cwd, pathLevels) => lines(ctx({ stdin: { cwd }, config: { pathLevels } }))[0].replace('[Opus] │ ', '');
  assert.equal(project('/home/u/dev/app', 2), 'dev/app');
  assert.equal(project('/home/u/dev/app/', 'full'), '/home/u/dev/app');
  assert.equal(project('/', 1), '/');
  assert.equal(project('C:\\Users\\me\\app', 1), 'app');
  assert.equal(project('C:\\Users\\me\\app', 'full'), 'C:/Users/me/app');
  assert.equal(project('C:\\', 'full'), 'C:/');
  assert.equal(project('\\\\server\\share\\app', 'full'), '//server/share/app');
});

test('the model badge keeps effort on the model and places the provider by showProvider', () => {
  const badge = (stdin, display = {}, transcript = {}) => lines(ctx({ stdin: { model: { display_name: 'Opus', id: 'opusplan' }, ...stdin }, transcript, config: { display } }))[0].split(' │ ')[0];
  const xhigh = { effort: { level: 'xhigh' } };
  assert.equal(badge({}), '[Opus | Enterprise]');
  assert.equal(badge(xhigh, { showEffortLevel: true }), '[Opus ◕ xhigh | Enterprise]');
  assert.equal(badge(xhigh, { showEffortLevel: true, showProvider: true, providerName: 'Acme' }), '[Acme | Opus ◕ xhigh]');
  assert.equal(badge(xhigh, { showEffortLevel: true, effortFormat: 'symbol' }), '[Opus ◕ | Enterprise]');
  assert.equal(badge(xhigh, { showEffortLevel: true, effortFormat: 'symbol' }, { ultracodeActive: true }), '[Opus ◕ ultracode(xhigh) | Enterprise]');
});

test('the advisor shows a readable model name or the override, capped', () => {
  const advisor = (advisorModel, display = {}) => lines(ctx({ transcript: { advisorModel }, config: { display: { showAdvisor: true, ...display } } }))[0].split(' │ ').at(-1);
  assert.equal(advisor('claude-opus-4-7'), 'Advisor: Opus 4.7');
  assert.equal(advisor('sonnet'), 'Advisor: Sonnet');
  assert.equal(advisor('claude-custom-x'), 'Advisor: custom-x');
  assert.equal(advisor('claude-opus-4-7', { advisorOverride: 'Reviewer' }), 'Advisor: Reviewer');
  assert.equal(advisor('x'.repeat(80)), `Advisor: ${'x'.repeat(64)}`);
  assert.equal(advisor(undefined), 'my-project');
});

test('projectLineOrder moves keyed parts and keeps unlisted ones after them', () => {
  const config = { projectLineOrder: ['duration', 'project'], display: { showDuration: true, showSessionName: true, customLine: 'hi', customLinePosition: 'first' } };
  const stdin = { session_name: 'auth-fix', cost: { total_duration_ms: 5 * MINUTE } };
  assert.equal(lines(ctx({ stdin, config }))[0], 'hi │ ⏱️  5m │ my-project │ [Opus] │ auth-fix');
});

const gitStatus = { branch: 'main', isDirty: true, ahead: 3, behind: 1, lineDiff: { added: 12, deleted: 4 }, fileStats: { modified: 2, added: 1, deleted: 1, untracked: 3, trackedFiles: [] } };
const gitConfig = { gitStatus: { showAheadBehind: true, showFileStats: true, showWorktree: true, pushWarningThreshold: 2, pushCriticalThreshold: 3 } };

test('git shows line diffs in expanded and file counts in compact', () => {
  const stdin = { workspace: { git_worktree: 'feature-x' } };
  assert.equal(lines(ctx({ gitStatus, stdin, config: gitConfig }))[0], '[Opus] │ my-project git:(main* ↑3 ↓1 [+12 -4]) ⎇ feature-x');
  assert.equal(lines(ctx({ gitStatus, stdin, config: compact(gitConfig) }))[0], '[Opus] █████░░░░░ 45% | my-project git:(main* ↑3 ↓1 !2 +1 ✘1 ?3) ⎇ feature-x');
  assert.ok(raw(ctx({ gitStatus, config: gitConfig }))[0].includes(`${RED}↑3`), 'at the critical threshold');
  assert.equal(lines(ctx({ gitStatus, config: { gitStatus: { enabled: false } } }))[0], '[Opus] │ my-project');
});

test('git branchOverflow wrap puts git in its own part', () => {
  const config = { gitStatus: { branchOverflow: 'wrap' } };
  assert.equal(lines(ctx({ gitStatus, config }))[0], '[Opus] │ my-project │ git:(main*)');
  assert.deepEqual(lines(ctx({ gitStatus, config }), 15).slice(0, 3), ['[Opus]', 'my-project', 'git:(main*)']);
});

test('jj has its own toggle, a conflict marker, and no git-only details', () => {
  const jj = { ...gitStatus, vcs: 'jj', conflict: true, branchUrl: 'https://github.com/a/b/tree/main' };
  const config = { ...gitConfig, jjStatus: { enabled: true } };
  const stdin = { workspace: { git_worktree: 'feature-x' } };
  assert.equal(lines(ctx({ gitStatus: jj, stdin, config }))[0], '[Opus] │ my-project jj:(main* !conflict)');
  assert.ok(!raw(ctx({ gitStatus: jj, config }))[0].includes('github.com'), 'no branch link');
  assert.equal(lines(ctx({ gitStatus: jj, config: gitConfig }))[0], '[Opus] │ my-project');
  assert.equal(lines(ctx({ gitStatus: jj, config: { jjStatus: { enabled: true, showConflicts: false, showDirty: false } } }))[0], '[Opus] │ my-project jj:(main)');
});

test('the git files line lists the newest files first and hides below 60 columns', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'hud-files-'));
  try {
    const names = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts', 'g.ts'];
    names.forEach((name, index) => {
      writeFileSync(path.join(cwd, name), '');
      utimesSync(path.join(cwd, name), new Date(2026, 0, 1 + index), new Date(2026, 0, 1 + index));
    });
    const trackedFiles = [
      ...names.map((name) => ({ basename: name, fullPath: name, type: 'modified', lineDiff: { added: 1, deleted: 0 } })),
      { basename: 'outside.ts', fullPath: '../outside.ts', type: 'added' },
    ];
    const status = { ...gitStatus, fileStats: { ...gitStatus.fileStats, trackedFiles } };
    const c = ctx({ gitStatus: status, stdin: { cwd }, config: gitConfig });
    const files = raw(c, 120).at(-1);
    assert.equal(plain(files), '~g.ts(+1)  ~f.ts(+1)  ~e.ts(+1)  ~d.ts(+1)  ~c.ts(+1)  ~b.ts(+1)  +2 more  ?3');
    assert.ok(files.includes(`file://${cwd}/g.ts`));
    assert.ok(!lines(c, 59).some((line) => line.includes('g.ts')));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('showSeparators puts a rule before the first activity line, clamped to the width', () => {
  const tool = { id: '1', name: 'Read', status: 'completed', startTime: ago(MINUTE) };
  const config = { showSeparators: true, display: { showTools: true } };
  assert.deepEqual(lines(ctx({ transcript: { tools: [tool] }, config })).slice(2), ['─'.repeat(22), '✓ Read ×1']);
  assert.equal(lines(ctx({ transcript: { tools: [tool] }, config }), 15).find((line) => line.startsWith('─')), '─'.repeat(15));
  assert.equal(lines(ctx({ config })).length, 2, 'no activity, no rule');
});

test('tools show the two newest running, then counts by frequency', () => {
  const tool = (name, status, target) => ({ id: `${name}${Math.random()}`, name, status, target, startTime: ago(MINUTE) });
  const tools = [
    tool('Read', 'completed'), tool('Read', 'completed'), tool('Edit', 'error'), tool('Glob', 'completed'), tool('Bash', 'completed'),
    tool('Grep', 'completed'), tool('Write', 'running', 'C:\\work\\src\\very\\long\\path\\auth.ts'), tool('mcp__github__create_issue', 'running'),
  ];
  const display = { showTools: true, toolNameMaxLength: 10 };
  assert.equal(lines(ctx({ transcript: { tools }, config: { display } }))[2], '◐ Write: .../auth.ts | ◐ create_is… | ✓ Read ×2 | ✓ Edit ×1 | ✓ Glob ×1 | ✓ Bash ×1 | +1 more');
  const skill = tool('Skill', 'completed');
  assert.deepEqual(lines(ctx({ transcript: { tools: [skill, tools[0]], skills: ['commit'] }, config: { display: { showTools: true, showSkills: true } } })).slice(2), [
    '✓ Read ×1',
    '✓ Skills (1): commit',
  ]);
});

test('agents show running first, then those finished within a minute, three at most', () => {
  const agent = (id, status, startedAgo, endedAgo, extra = {}) => ({ id, type: id, status, startTime: ago(startedAgo), endTime: endedAgo === undefined ? undefined : ago(endedAgo), ...extra });
  const agents = [
    agent('explore', 'running', 2 * MINUTE, undefined, { model: 'claude-haiku-4-5-20251001', description: 'Finding auth code' }),
    agent('stale', 'completed', 10 * MINUTE, 61 * SECOND),
    agent('plan', 'completed', 5 * MINUTE, 30 * SECOND),
    agent('review', 'completed', 2 * HOUR + 3 * MINUTE, 10 * SECOND),
  ];
  const config = { display: { showAgents: true } };
  assert.deepEqual(lines(ctx({ transcript: { agents }, config })).slice(2), [
    '◐ explore [haiku-4.5]: Finding auth code (2m 0s)',
    '✓ plan (4m 30s)',
    '✓ review (2h 2m)',
  ]);
  const running = ['a', 'b', 'c', 'd'].map((id) => agent(id, 'running', 500));
  assert.deepEqual(lines(ctx({ transcript: { agents: [...running, agents[2]] }, config })).slice(2), ['◐ b (<1s)', '◐ c (<1s)', '◐ d (<1s)']);
  const untrusted = [agent('no-end', 'completed', MINUTE), { ...agent('nan', 'completed', MINUTE), endTime: new Date(NaN) }, agent('future', 'completed', MINUTE, -5 * SECOND)];
  assert.equal(lines(ctx({ transcript: { agents: untrusted }, config })).length, 2, 'no trustworthy completion time');
});

test('agent model IDs shorten to family and version; others pass through', () => {
  const model = (id) => lines(ctx({ transcript: { agents: [{ id: 'a', type: 't', model: id, status: 'running', startTime: ago(SECOND) }] }, config: { display: { showAgents: true } } }))[2];
  assert.equal(model('claude-opus-4-8[1m]'), '◐ t [opus-4.8] (1s)');
  assert.equal(model('claude-sonnet-5'), '◐ t [sonnet-5] (1s)');
  assert.equal(model('claude-3-7-sonnet-20250219'), '◐ t [sonnet-3.7] (1s)');
  assert.equal(model('us.anthropic.claude-opus-4-6-v1:0'), '◐ t [us.anthropic.claude-opus-4-6-v1:0] (1s)');
  assert.equal(model('claude-fable-5'), '◐ t [claude-fable-5] (1s)');
  assert.equal(model('claude-'), '◐ t (1s)');
});

test('todos show the task in progress, or completion once every item is done', () => {
  const config = { display: { showTodos: true } };
  const todos = [{ content: 'Fix the bug', status: 'in_progress' }, { content: 'b', status: 'completed' }, { content: 'c', status: 'pending' }];
  assert.equal(lines(ctx({ transcript: { todos }, config }))[2], '▸ Fix the bug (1/3)');
  assert.equal(lines(ctx({ transcript: { todos: todos.slice(1) }, config })).length, 2, 'nothing in progress, not all done');
  assert.equal(lines(ctx({ transcript: { todos: [todos[1]] }, config }))[2], '✓ All todos complete (1/1)');
});

test('the environment line names failing MCP servers and respects environmentThreshold', () => {
  const counts = { claudeMdCount: 2, rulesCount: 3, mcpCount: 4, hooksCount: 1 };
  const transcript = { mcpErrors: ['github', 'linear', 'slack', 'notion'] };
  assert.equal(lines(ctx({ ...counts, transcript, config: { display: { showConfigCounts: true } } }))[2], '2 CLAUDE.md | 3 rules | 4 MCPs ⚠ github, linear, slack +1 | 1 hooks');
  assert.equal(lines(ctx({ claudeMdCount: 2, config: { display: { showConfigCounts: true, environmentThreshold: 5 } } })).length, 2);
  assert.equal(lines(ctx({ transcript: { mcpErrors: ['github'] }, config: { display: { showMcp: true } } }))[2], '⚠ github');
});

test('the session time line shows the start date and how long ago the last reply was', () => {
  const transcript = { sessionStart: new Date(2026, 8, 30, 9, 5), lastAssistantResponseAt: ago(2 * MINUTE + 5 * SECOND) };
  const config = { display: { showSessionStartDate: true, showLastResponseAt: true }, elementOrder: ['sessionTime'] };
  assert.deepEqual(lines(ctx({ transcript, config })), ['Started: 2026-09-30 09:05 │ Last reply: 2m ago']);
  setLanguage('zh-Hant');
  assert.match(lines(ctx({ transcript, config }))[0], /2m 前$/);
});

test('Chinese labels translate the session token summary in both layouts', () => {
  setLanguage('zh-Hans');
  const transcript = { sessionTokens: { inputTokens: 12345, outputTokens: 6789, cacheCreationTokens: 0, cacheReadTokens: 4321 } };
  const config = { display: { showSessionTokens: true } };
  assert.equal(lines(ctx({ transcript, config })).at(-1), '词元 23k (输入: 12k, 输出: 7k, 缓存: 4k)');
  assert.match(lines(ctx({ transcript, config: compact(config) }))[0], /\| 词元: 23k \(输入: 12k, 输出: 7k, 缓存: 4k\)$/);
});

test('wrap width: columns, then maxWidth, and forceMaxWidth overrides columns', () => {
  const long = ctx({ usageData: usage(), config: { maxWidth: 40 } });
  assert.equal(lines(long).length, 3, 'maxWidth applies when the width is unknown');
  assert.equal(lines(long, 120).length, 2, 'a known width wins over maxWidth');
  const forced = ctx({ usageData: usage(), config: { maxWidth: 40, forceMaxWidth: true } });
  assert.equal(lines(forced, 120).length, 3);
  assert.equal(lines(ctx({ usageData: usage() })).length, 2, 'no width, no wrapping');
});

test('untrusted text cannot emit terminal control sequences', () => {
  const hostile = '\x1b]52;c;ZXZpbA==\x07X\x1b[2J\u202E';
  const started = ago(MINUTE);
  for (const layout of [{}, compact()]) {
    const out = raw(ctx({
      stdin: { model: { display_name: hostile }, cwd: `/home/${hostile}`, session_name: hostile, workspace: { added_dirs: [`/a/${hostile}`], git_worktree: hostile } },
      transcript: {
        tools: [{ id: '1', name: hostile, target: hostile, status: 'running', startTime: started }, { id: '2', name: hostile, status: 'completed', startTime: started }],
        agents: [{ id: 'a', type: hostile, model: hostile, description: hostile, status: 'running', startTime: started }],
        todos: [{ content: hostile, status: 'in_progress' }],
        skills: [hostile],
        mcpErrors: [hostile],
        advisorModel: hostile,
      },
      gitStatus: { branch: hostile, isDirty: false, ahead: 0, behind: 0, fileStats: { modified: 1, added: 0, deleted: 0, untracked: 0, trackedFiles: [{ basename: hostile, fullPath: hostile, type: 'modified' }] } },
      config: {
        ...layout,
        gitStatus: { showFileStats: true, showWorktree: true },
        display: { showSessionName: true, showTools: true, showAgents: true, showTodos: true, showSkills: true, showMcp: true, showAdvisor: true },
      },
    })).join('\n');
    const visible = out.replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\]8;;[^\x07\x1b]*\x1b\\/g, '');
    assert.doesNotMatch(visible, /[\x00-\x09\x0b-\x1f\x7f-\x9f\u202a-\u202e]/);
    assert.ok(!out.includes('\x1b]52'));
  }
});
