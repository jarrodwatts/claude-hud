import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../dist/render/index.js';
import { mergeConfig } from '../dist/config.js';
import { setLanguage } from '../dist/i18n/index.js';

const originalDisableTtyWidth = process.env.CLAUDE_HUD_DISABLE_TTY_WIDTH;

before(() => {
  process.env.CLAUDE_HUD_DISABLE_TTY_WIDTH = '1';
});

after(() => {
  if (originalDisableTtyWidth === undefined) {
    delete process.env.CLAUDE_HUD_DISABLE_TTY_WIDTH;
  } else {
    process.env.CLAUDE_HUD_DISABLE_TTY_WIDTH = originalDisableTtyWidth;
  }
});

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
      gitStatus: { enabled: true, showDirty: true, showAheadBehind: false, showFileStats: false, branchOverflow: 'truncate' },
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
        mergeGroups: [['context', 'usage']],
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
  return str
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
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

function withColumns(stream, columns, fn) {
  const originalColumns = stream.columns;
  Object.defineProperty(stream, 'columns', { value: columns, configurable: true });
  try {
    fn();
  } finally {
    if (originalColumns === undefined) {
      delete stream.columns;
    } else {
      Object.defineProperty(stream, 'columns', { value: originalColumns, configurable: true });
    }
  }
}

function withTerminal(columns, fn) {
  withColumns(process.stdout, columns, fn);
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

test('render can wrap git to its own line without truncating the branch name', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '/tmp/project-with-a-long-name';
  ctx.gitStatus = {
    branch: 'feature/this-is-a-very-long-branch-name',
    isDirty: true,
    ahead: 0,
    behind: 0,
  };
  ctx.config.gitStatus.branchOverflow = 'wrap';

  let lines = [];
  withTerminal(55, () => {
    lines = captureRender(ctx);
  });

  assert.ok(lines.every(line => displayWidth(line) <= 55), 'all lines should fit terminal width');
  assert.ok(lines.some(line => line.includes('git:(feature/this-is-a-very-long-branch-name*)')), 'git branch should remain intact on its own line');
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

test('render falls back to stderr.columns when stdout.columns and COLUMNS are unavailable', () => {
  const ctx = baseContext();
  const originalEnvColumns = process.env.COLUMNS;

  let lines = [];
  withColumns(process.stdout, undefined, () => {
    withColumns(process.stderr, 12, () => {
      delete process.env.COLUMNS;
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
  });

  assert.ok(lines.length > 0, 'should still render output lines');
  assert.ok(lines.every(line => displayWidth(line) <= 12), 'stderr width should be honored');
  assert.ok(lines.some(line => displayWidth(line) > 10), 'stderr width should be used when no env override exists');
});

test('render ignores OSC 8 hyperlink sequences when measuring line width', () => {
  const ctx = baseContext();
  ctx.config.lineLayout = 'compact';
  ctx.stdin.context_window.current_usage.input_tokens = 0;
  ctx.config.display.showContextBar = false;
  ctx.config.display.showConfigCounts = false;
  ctx.config.display.showUsage = false;
  ctx.stdin.cwd = '/tmp/my-project';
  ctx.sessionDuration = '1m';
  ctx.extraLabel = '\x1b]8;;file:///tmp/my-project\x1b\\linked-label\x1b]8;;\x1b\\';

  let lines = [];
  withTerminal(47, () => {
    lines = captureRender(ctx);
  });

  assert.equal(lines.length, 1, 'a visibly short line with an OSC 8 hyperlink should stay on one line');
  assert.ok(lines[0].includes('linked-label'), 'hyperlink label text should still render');
  assert.ok(lines[0].includes('1m'), 'later elements should not be wrapped off the line');
  assert.ok(displayWidth(lines[0]) <= 47, 'visible width should respect terminal width');
});

test('render ignores BEL-terminated OSC 8 hyperlink sequences when measuring line width', () => {
  const ctx = baseContext();
  ctx.config.lineLayout = 'compact';
  ctx.stdin.context_window.current_usage.input_tokens = 0;
  ctx.config.display.showContextBar = false;
  ctx.config.display.showConfigCounts = false;
  ctx.config.display.showUsage = false;
  ctx.stdin.cwd = '/tmp/my-project';
  ctx.sessionDuration = '1m';
  ctx.extraLabel = '\x1b]8;;file:///tmp/my-project\x07linked-label\x1b]8;;\x07';

  let lines = [];
  withTerminal(47, () => {
    lines = captureRender(ctx);
  });

  assert.equal(lines.length, 1, 'a visibly short BEL-terminated OSC 8 hyperlink should stay on one line');
  assert.ok(lines[0].includes('linked-label'), 'hyperlink label text should still render');
  assert.ok(lines[0].includes('1m'), 'later elements should not be wrapped off the line');
  assert.ok(displayWidth(lines[0]) <= 47, 'visible width should respect terminal width');
});

test('render uses default fallback width when no real terminal width is available', () => {
  const ctx = baseContext();
  ctx.stdin.model = { display_name: 'Sonnet 4.6' };
  ctx.stdin.cwd = '/tmp/very-long-project-name-for-ghostty-fallback-check';
  ctx.gitStatus = {
    branch: 'feature/ghostty-width-fallback',
    isDirty: true,
    ahead: 0,
    behind: 0,
    fileStats: { modified: 2, added: 1, deleted: 0, untracked: 1 },
  };
  ctx.config.gitStatus.showFileStats = true;
  ctx.usageData = {
    planName: 'Pro',
    fiveHour: 42,
    sevenDay: 12,
    fiveHourResetAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    sevenDayResetAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  };

  const originalEnvColumns = process.env.COLUMNS;
  let lines = [];
  withColumns(process.stdout, undefined, () => {
    withColumns(process.stderr, undefined, () => {
      delete process.env.COLUMNS;
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
  });

  assert.ok(lines.length >= 1, 'should still produce output');
  assert.ok(lines.every(line => displayWidth(line) <= 120), 'all lines should fit the default fallback width');
});

test('render uses config.maxWidth as fallback when terminal width is unavailable', () => {
  const ctx = baseContext();
  ctx.stdin.model = { display_name: 'Sonnet 4.6' };
  ctx.stdin.cwd = '/tmp/very-long-project-name-for-maxwidth-fallback';
  ctx.config.maxWidth = 30;
  ctx.usageData = {
    fiveHour: 42,
    sevenDay: null,
    fiveHourResetAt: null,
    sevenDayResetAt: null,
  };

  // When no terminal size is available, maxWidth should be used as fallback
  const originalEnvColumns = process.env.COLUMNS;
  let lines = [];
  withColumns(process.stdout, undefined, () => {
    withColumns(process.stderr, undefined, () => {
      delete process.env.COLUMNS;
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
  });

  assert.ok(lines.length > 0, 'should produce output');
  assert.ok(lines.every(line => displayWidth(line) <= 30), 'all lines should fit within maxWidth');
});

test('render ignores config.maxWidth when terminal width is detected', () => {
  const ctx = baseContext();
  ctx.stdin.model = { display_name: 'Sonnet 4.6' };
  ctx.stdin.cwd = '/tmp/project';
  ctx.config.maxWidth = 30;

  // When terminal reports a real width, maxWidth should NOT cap it
  let lines = [];
  withTerminal(120, () => {
    lines = captureRender(ctx);
  });

  // Lines should use the detected 120 columns, not the 30 maxWidth
  assert.ok(lines.length > 0, 'should produce output');
  assert.ok(lines.every(line => displayWidth(line) <= 120), 'lines should fit detected width');
  // Compact session line is typically wider than 30 when model+context are shown
  const widest = Math.max(...lines.map(displayWidth));
  assert.ok(widest > 30, 'should use detected terminal width, not maxWidth');
});

test('render treats an actual 40-column terminal as a real width', () => {
  const ctx = baseContext();
  ctx.stdin.cwd = '/tmp/very-long-project-name-for-real-40-column-check';
  ctx.extraLabel = 'extra-segment-for-40-column-check';

  let lines = [];
  withTerminal(40, () => {
    lines = captureRender(ctx);
  });

  assert.ok(lines.length > 1, 'real 40-column terminals should still wrap');
  assert.ok(lines.every(line => displayWidth(line) <= 40), 'all lines should respect the real 40-column width');
});

test('render does not treat a real 40-column terminal as unknown maxWidth fallback', () => {
  const ctx = baseContext();
  ctx.config.maxWidth = 30;
  ctx.config.display.showModel = false;
  ctx.config.display.showContextBar = false;
  ctx.config.display.showProject = false;
  ctx.config.display.showConfigCounts = false;
  ctx.config.display.showDuration = false;
  ctx.extraLabel = '12345678901234567890123456789012345';

  let lines = [];
  withTerminal(40, () => {
    lines = captureRender(ctx);
  });

  assert.equal(lines.length, 1, 'real 40-column terminals should not fall back to maxWidth wrapping');
  assert.ok(lines[0].includes('12345678901234567890123456789012345'), 'full extra label should remain visible at the real terminal width');
  assert.ok(lines.every(line => displayWidth(line) <= 40), 'lines should still fit the real terminal width');
});

test('render does not strand a bare 5h continuation line in compact mode', () => {
  const ctx = baseContext();
  ctx.config.lineLayout = 'compact';
  ctx.config.display.usageBarEnabled = false;
  ctx.config.display.showConfigCounts = false;
  ctx.stdin.cwd = '/tmp/project';
  ctx.usageData = {
    planName: 'Pro',
    fiveHour: 30,
    sevenDay: 85,
    fiveHourResetAt: new Date(Date.now() + 60 * 60 * 1000),
    sevenDayResetAt: new Date(Date.now() + 28 * 60 * 60 * 1000),
  };

  let lines = [];
  withColumns(process.stdout, undefined, () => {
    withColumns(process.stderr, 40, () => {
      lines = captureRender(ctx);
    });
  });

  assert.ok(lines.some(line => line.includes('Usage 5h 30%')), `expected usage window to keep its label: ${lines.join(' | ')}`);
  assert.ok(lines.some(line => line.includes('Weekly 85%')), `expected weekly usage window to render: ${lines.join(' | ')}`);
  assert.ok(!lines.some(line => line.startsWith('5h ')), `did not expect a bare 5h continuation line: ${lines.join(' | ')}`);
});

test('render treats COLUMNS env as a hard override over stdout width', () => {
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

  assert.ok(lines.every(line => displayWidth(line) <= 10), 'COLUMNS override should be honored');
  assert.ok(lines.length > 1, 'narrow env override should force wrapping');
});

test('render does not split model/provider separator inside brackets', () => {
  process.env.CLAUDE_CODE_USE_BEDROCK = '1';
  try {
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
  } finally {
    delete process.env.CLAUDE_CODE_USE_BEDROCK;
  }
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

test('render keeps default merge-group elements as separate lines when a narrow terminal cannot fit both', () => {
  const ctx = baseContext();
  ctx.config.lineLayout = 'expanded';
  ctx.config.display.usageBarEnabled = true;
  ctx.stdin.context_window.current_usage.input_tokens = 120000;
  ctx.usageData = {
    fiveHour: 62,
    sevenDay: null,
    fiveHourResetAt: null,
    sevenDayResetAt: null,
  };

  let lines = [];
  withTerminal(24, () => {
    lines = captureRender(ctx);
  });

  assert.ok(lines.some(line => line.includes('Context')), 'context line should remain visible');
  assert.ok(lines.some(line => line.includes('Usage')), 'usage line should remain visible');
  assert.ok(lines.every(line => displayWidth(line) <= 24), 'all lines should still fit terminal width');
});

test('render respects terminal width with Chinese labels enabled', () => {
  const ctx = baseContext();
  ctx.config.lineLayout = 'expanded';
  ctx.usageData = {
    planName: 'Pro',
    fiveHour: 42,
    sevenDay: 12,
    fiveHourResetAt: new Date(Date.now() + 90 * 60000),
    sevenDayResetAt: new Date(Date.now() + 24 * 60 * 60000),
  };

  let lines = [];
  setLanguage('zh');
  try {
    withTerminal(18, () => {
      lines = captureRender(ctx);
    });
  } finally {
    setLanguage('en');
  }

  assert.ok(lines.some(line => line.includes('上下文')), 'should render the translated context label');
  assert.ok(lines.some(line => line.includes('用量')), 'should render the translated usage label');
  assert.ok(lines.every(line => displayWidth(line) <= 18), 'all lines should fit terminal width with CJK labels');
});

// CJK terminals render East Asian Ambiguous chars (█ ░ │ ◐ ✓ etc.) as 2 cells.
// Without compensating width math, lines that look short to the code overflow
// the visible terminal and get wrapped by the terminal itself.
function ambiguousDisplayWidth(text) {
  let width = 0;
  for (const char of Array.from(text)) {
    const cp = char.codePointAt(0);
    if (cp === undefined) {
      width += 1;
      continue;
    }
    if (isWideCodePoint(cp)) {
      width += 2;
      continue;
    }
    const isAmbiguousWide =
      (cp >= 0x2010 && cp <= 0x2027) ||
      (cp >= 0x2030 && cp <= 0x205E) ||
      (cp >= 0x2190 && cp <= 0x21FF) ||
      (cp >= 0x2200 && cp <= 0x22FF) ||
      (cp >= 0x2300 && cp <= 0x23FF) ||
      (cp >= 0x2460 && cp <= 0x24FF) ||
      (cp >= 0x2500 && cp <= 0x259F) ||
      (cp >= 0x25A0 && cp <= 0x25FF) ||
      (cp >= 0x2600 && cp <= 0x26FF) ||
      (cp >= 0x2700 && cp <= 0x27BF);
    width += isAmbiguousWide ? 2 : 1;
  }
  return width;
}

test('render wraps progress bars when CJK ambiguous-width chars overflow the terminal', () => {
  const ctx = baseContext();
  ctx.config.language = 'zh';
  ctx.config.lineLayout = 'expanded';
  ctx.config.display.showUsage = true;
  ctx.config.display.usageBarEnabled = true;
  ctx.usageData = {
    fiveHour: 49,
    sevenDay: null,
    fiveHourResetAt: new Date(Date.now() + 3 * 3600 * 1000 + 12 * 60 * 1000),
    sevenDayResetAt: null,
  };

  let cjkLines = [];
  setLanguage('zh');
  try {
    withTerminal(40, () => {
      cjkLines = captureRender(ctx);
    });
  } finally {
    setLanguage('en');
  }

  assert.ok(
    cjkLines.every(line => ambiguousDisplayWidth(line) <= 40),
    'no line should overflow 40 cells when ambiguous-width chars count as 2',
  );

  let enLines = [];
  withTerminal(40, () => {
    enLines = captureRender(ctx);
  });
  assert.ok(enLines.length > 0, 'non-CJK mode should still produce output');
});

test('separator width accounts for CJK ambiguous-wide dashes so the terminal does not wrap it', () => {
  const ctx = baseContext();
  ctx.config.lineLayout = 'expanded';
  ctx.config.showSeparators = true;
  ctx.config.display.showContextBar = true;
  ctx.config.display.showUsage = true;
  ctx.config.display.usageBarEnabled = true;
  ctx.usageData = {
    fiveHour: 49,
    sevenDay: null,
    fiveHourResetAt: new Date(Date.now() + 3 * 3600 * 1000),
    sevenDayResetAt: null,
  };
  ctx.transcript.tools = [
    { id: 'tool-1', name: 'Read', status: 'completed', startTime: new Date(0), endTime: new Date(0), duration: 0 },
  ];

  let cjkLines = [];
  setLanguage('zh');
  try {
    withTerminal(120, () => {
      cjkLines = captureRender(ctx);
    });
  } finally {
    setLanguage('en');
  }

  const separatorLines = cjkLines.filter(line => /^[\s─]+$/.test(line));
  assert.equal(separatorLines.length, 1, 'separator should render exactly once and not be split into multiple lines');
  assert.ok(
    ambiguousDisplayWidth(separatorLines[0]) <= 120,
    `separator visual width must fit terminal in CJK mode (got ${ambiguousDisplayWidth(separatorLines[0])} cells, terminal=120)`,
  );

  for (const line of cjkLines) {
    assert.ok(
      ambiguousDisplayWidth(line) <= 120,
      `line "${line}" exceeds 120 cells in CJK mode (got ${ambiguousDisplayWidth(line)})`,
    );
  }
});

test('render greedily packs merge-group elements onto rows that fit, splitting only when the next element would overflow', () => {
  // Build a context with several mergeable elements (context, zenmux,
  // environment) and verify:
  //   - On a wide enough terminal, all three pack into a single row.
  //   - On an intermediate width, packing splits into multiple rows but
  //     keeps as many elements per row as fit.
  //   - On a narrow terminal, every element stacks alone.
  function packingContext() {
    const ctx = baseContext();
    ctx.config.lineLayout = 'expanded';
    ctx.config.elementOrder = ['project', 'context', 'zenmux', 'environment'];
    ctx.config.display.mergeGroups = [['context', 'zenmux', 'environment']];
    ctx.config.display.showZenmuxQuota = true;
    ctx.config.display.showContextBar = true;
    ctx.config.display.showConfigCounts = true;
    ctx.config.display.showUsage = false;
    ctx.config.display.usageBarEnabled = false;
    ctx.claudeMdCount = 1;
    ctx.hooksCount = 6;
    ctx.zenmuxQuota = {
      accountStatus: 'healthy',
      fiveHour: { usagePercentage: 49, resetsAt: new Date(Date.now() + 3 * 3600 * 1000) },
      sevenDay: { usagePercentage: 49, resetsAt: new Date(Date.now() + 24 * 3600 * 1000) },
    };
    return ctx;
  }

  let wide = [];
  withTerminal(300, () => {
    wide = captureRender(packingContext());
  });
  const wideMerged = wide.filter(line => line.includes('Context') && line.includes('ZenMux') && line.includes('CLAUDE.md'));
  assert.equal(wideMerged.length, 1, `wide terminal should pack all merge-group elements onto one row: ${wide.join(' | ')}`);
  assert.ok(wide.every(line => displayWidth(line) <= 300), 'all lines should fit terminal width');

  let mid = [];
  withTerminal(100, () => {
    mid = captureRender(packingContext());
  });
  // At 100 cells Context+ZenMux pack onto one row (~95 cells) but adding
  // Environment would overflow, so packing splits Environment to a new row.
  const midContextZenmuxRow = mid.filter(line => line.includes('Context') && line.includes('ZenMux'));
  const midEnvRow = mid.filter(line => line.includes('CLAUDE.md'));
  assert.equal(midContextZenmuxRow.length, 1, `context should pack with zenmux when there is room: ${mid.join(' | ')}`);
  assert.equal(midEnvRow.length, 1, 'environment should appear on exactly one row');
  assert.notEqual(midContextZenmuxRow[0], midEnvRow[0], 'environment must split to a new row when adding it would overflow');
  assert.ok(mid.every(line => displayWidth(line) <= 100), 'all lines should fit terminal width');

  let narrow = [];
  withTerminal(40, () => {
    narrow = captureRender(packingContext());
  });
  const narrowContextRow = narrow.filter(line => line.includes('Context'));
  const narrowZenmuxRow = narrow.filter(line => line.includes('ZenMux'));
  assert.equal(narrowContextRow.length, 1, 'context should appear on its own row at narrow widths');
  assert.equal(narrowZenmuxRow.length, 1, 'zenmux should remain visible at narrow widths');
  assert.notEqual(narrowContextRow[0], narrowZenmuxRow[0], 'narrow stacking: context must not share row with zenmux');
  assert.ok(narrow.every(line => displayWidth(line) <= 40), 'all narrow rows should fit terminal width');
});

test('render keeps default merge-group rows visible when a narrow terminal forces wrapping', () => {
  const ctx = baseContext();
  ctx.config = mergeConfig({
    lineLayout: 'expanded',
    display: {
      showContextBar: true,
      showUsage: true,
      usageBarEnabled: false,
      showZenmuxQuota: true,
      showPromptCache: true,
      showMemoryUsage: true,
      showConfigCounts: true,
    },
  });
  ctx.usageData = {
    fiveHour: 62,
    sevenDay: 83,
    fiveHourResetAt: new Date(Date.now() + 90 * 60 * 1000),
    sevenDayResetAt: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000),
  };
  ctx.zenmuxQuota = {
    accountStatus: 'healthy',
    fiveHour: { usagePercentage: 40, resetsAt: null },
    sevenDay: { usagePercentage: 45, resetsAt: null },
  };
  ctx.transcript.lastAssistantResponseAt = new Date();
  ctx.memoryUsage = {
    totalBytes: 16 * 1024 ** 3,
    usedBytes: 8 * 1024 ** 3,
    freeBytes: 8 * 1024 ** 3,
    usedPercent: 50,
  };
  ctx.claudeMdCount = 1;
  ctx.hooksCount = 2;

  let lines = [];
  withTerminal(32, () => {
    lines = captureRender(ctx);
  });

  assert.ok(lines.some(line => line.includes('Context')), 'context row should remain visible');
  assert.ok(lines.some(line => line.includes('Usage')), 'usage row should remain visible');
  assert.ok(lines.some(line => line.includes('ZenMux')), 'zenmux row should remain visible');
  assert.ok(lines.every(line => displayWidth(line) <= 32), 'all wrapped rows should fit terminal width');
});

function statuslineBudgetContext(columns) {
  const ctx = baseContext();
  ctx.stdin.columns = columns;
  ctx.stdin.cwd = '/tmp/ava';
  ctx.config = mergeConfig({
    lineLayout: 'expanded',
    display: {
      showContextBar: true,
      showUsage: true,
      usageBarEnabled: true,
      showZenmuxQuota: true,
      showMemoryUsage: true,
      showConfigCounts: true,
      showTokenBreakdown: true,
    },
  });
  ctx.usageData = {
    fiveHour: 97,
    sevenDay: 55,
    fiveHourResetAt: new Date(Date.now() + 90 * 60 * 1000),
    sevenDayResetAt: new Date(Date.now() + 22 * 60 * 60 * 1000),
  };
  ctx.zenmuxQuota = {
    accountStatus: 'healthy',
    fiveHour: { usagePercentage: 97, resetsAt: new Date(Date.now() + 90 * 60 * 1000) },
    sevenDay: { usagePercentage: 55, resetsAt: new Date(Date.now() + 22 * 60 * 60 * 1000) },
  };
  ctx.memoryUsage = {
    totalBytes: 24 * 1024 ** 3,
    usedBytes: 9.2 * 1024 ** 3,
    freeBytes: 14.8 * 1024 ** 3,
    usedPercent: 38,
  };
  ctx.claudeMdCount = 1;
  ctx.hooksCount = 6;
  return ctx;
}

test('render keeps the default status group within a safe row budget at 99 columns', () => {
  let lines = [];
  withColumns(process.stdout, undefined, () => {
    withColumns(process.stderr, undefined, () => {
      lines = captureRender(statuslineBudgetContext(99));
    });
  });

  assert.ok(lines.length <= 3, `statusline should stay within project + 2 info rows: ${lines.join(' | ')}`);
  assert.ok(lines.some(line => line.includes('Context')), 'context row should remain visible');
  assert.ok(lines.some(line => line.includes('Usage')), 'usage row should remain visible');
  assert.ok(lines.some(line => line.includes('ZenMux')), 'zenmux row should remain visible');
  assert.ok(lines.some(line => line.includes('Approx RAM')), 'memory row should remain visible at 99 columns');
  assert.ok(lines.some(line => line.includes('CLAUDE.md')), 'environment row should remain visible at 99 columns');
  assert.ok(lines.every(line => displayWidth(line) <= 99), 'all rows should fit 99 columns');
});

test('render keeps the default status group within a safe row budget at 160 columns', () => {
  let lines = [];
  withColumns(process.stdout, undefined, () => {
    withColumns(process.stderr, undefined, () => {
      lines = captureRender(statuslineBudgetContext(160));
    });
  });

  assert.ok(lines.length <= 3, `statusline should stay within project + 2 info rows: ${lines.join(' | ')}`);
  assert.ok(lines.some(line => line.includes('Context')), 'context row should remain visible');
  assert.ok(lines.some(line => line.includes('Usage')), 'usage row should remain visible');
  assert.ok(lines.some(line => line.includes('ZenMux')), 'zenmux row should remain visible');
  assert.ok(lines.some(line => line.includes('Approx RAM')), 'memory row should remain visible at 160 columns');
  assert.ok(lines.some(line => line.includes('CLAUDE.md')), 'environment row should remain visible at 160 columns');
  assert.ok(lines.every(line => displayWidth(line) <= 160), 'all rows should fit 160 columns');
});

test('render keeps the default status group within a safe row budget at 170 columns', () => {
  let lines = [];
  withColumns(process.stdout, undefined, () => {
    withColumns(process.stderr, undefined, () => {
      lines = captureRender(statuslineBudgetContext(170));
    });
  });

  assert.ok(lines.length <= 3, `statusline should stay within project + 2 info rows: ${lines.join(' | ')}`);
  assert.ok(lines.some(line => line.includes('Context')), 'context row should remain visible');
  assert.ok(lines.some(line => line.includes('Usage')), 'usage row should remain visible');
  assert.ok(lines.some(line => line.includes('ZenMux')), 'zenmux row should remain visible');
  assert.ok(lines.every(line => displayWidth(line) <= 170), 'all rows should fit 170 columns');
});

test('render keeps the default status group within a safe row budget at 180 columns', () => {
  let lines = [];
  withColumns(process.stdout, undefined, () => {
    withColumns(process.stderr, undefined, () => {
      lines = captureRender(statuslineBudgetContext(180));
    });
  });

  assert.ok(lines.length <= 3, `statusline should stay within project + 2 info rows: ${lines.join(' | ')}`);
  assert.ok(lines.some(line => line.includes('Context')), 'context row should remain visible');
  assert.ok(lines.some(line => line.includes('Usage')), 'usage row should remain visible');
  assert.ok(lines.some(line => line.includes('ZenMux')), 'zenmux row should remain visible');
  assert.ok(lines.every(line => displayWidth(line) <= 180), 'all rows should fit 180 columns');
});

test('render prioritizes core status elements within the row budget at 80 columns', () => {
  let lines = [];
  withColumns(process.stdout, undefined, () => {
    withColumns(process.stderr, undefined, () => {
      lines = captureRender(statuslineBudgetContext(80));
    });
  });

  assert.ok(lines.length <= 3, `statusline should stay within project + 2 info rows: ${lines.join(' | ')}`);
  assert.ok(lines.some(line => line.includes('Context')), 'context row should remain visible');
  assert.ok(lines.some(line => line.includes('Usage')), 'usage row should remain visible');
  assert.ok(lines.some(line => line.includes('ZenMux')), 'zenmux row should remain visible');
  assert.ok(lines.every(line => displayWidth(line) <= 80), 'all rows should fit 80 columns');
});

test('render uses stdin columns when statusline stdout is piped', () => {
  const ctx = baseContext();
  ctx.stdin.columns = 300;
  ctx.config.lineLayout = 'expanded';
  ctx.config.elementOrder = ['project', 'context', 'zenmux', 'environment'];
  ctx.config.display.mergeGroups = [['context', 'zenmux', 'environment']];
  ctx.config.display.showZenmuxQuota = true;
  ctx.config.display.showContextBar = true;
  ctx.config.display.showConfigCounts = true;
  ctx.config.display.showUsage = false;
  ctx.claudeMdCount = 1;
  ctx.hooksCount = 6;
  ctx.zenmuxQuota = {
    accountStatus: 'healthy',
    fiveHour: { usagePercentage: 49, resetsAt: null },
    sevenDay: { usagePercentage: 49, resetsAt: null },
  };

  const originalEnvColumns = process.env.COLUMNS;
  let lines = [];
  withColumns(process.stdout, undefined, () => {
    withColumns(process.stderr, undefined, () => {
      delete process.env.COLUMNS;
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
  });

  const mergedRows = lines.filter(line => line.includes('Context') && line.includes('ZenMux') && line.includes('CLAUDE.md'));
  assert.equal(mergedRows.length, 1, `stdin columns should allow wide merge-group packing: ${lines.join(' | ')}`);
  assert.ok(lines.every(line => displayWidth(line) <= 300), 'all lines should fit stdin columns');
});

test('render wraps by stdin columns when statusline stdout is piped', () => {
  const ctx = baseContext();
  ctx.stdin.columns = 40;
  ctx.config.lineLayout = 'expanded';
  ctx.config.elementOrder = ['project', 'context', 'zenmux', 'environment'];
  ctx.config.display.mergeGroups = [['context', 'zenmux', 'environment']];
  ctx.config.display.showZenmuxQuota = true;
  ctx.config.display.showContextBar = true;
  ctx.config.display.showConfigCounts = true;
  ctx.config.display.showUsage = false;
  ctx.claudeMdCount = 1;
  ctx.hooksCount = 6;
  ctx.zenmuxQuota = {
    accountStatus: 'healthy',
    fiveHour: { usagePercentage: 49, resetsAt: null },
    sevenDay: { usagePercentage: 49, resetsAt: null },
  };

  const originalEnvColumns = process.env.COLUMNS;
  let lines = [];
  withColumns(process.stdout, undefined, () => {
    withColumns(process.stderr, undefined, () => {
      delete process.env.COLUMNS;
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
  });

  assert.ok(lines.some(line => line.includes('Context')), 'context row should remain visible');
  assert.ok(lines.some(line => line.includes('ZenMux')), 'zenmux row should remain visible');
  assert.ok(lines.every(line => displayWidth(line) <= 40), 'all rows should fit stdin columns');
});

test('render wraps default merge-group rows with fallback width when statusline stdout is piped', () => {
  const ctx = baseContext();
  ctx.config = mergeConfig({
    lineLayout: 'expanded',
    display: {
      showContextBar: true,
      showUsage: true,
      usageBarEnabled: true,
      showZenmuxQuota: true,
      showPromptCache: true,
      showMemoryUsage: true,
      showConfigCounts: true,
      showTokenBreakdown: true,
    },
  });
  ctx.stdin.context_window.current_usage.input_tokens = 100000;
  ctx.stdin.context_window.current_usage.cache_creation_input_tokens = 20000;
  ctx.stdin.context_window.current_usage.cache_read_input_tokens = 30000;
  ctx.usageData = {
    fiveHour: 62,
    sevenDay: 83,
    fiveHourResetAt: new Date(Date.now() + 90 * 60 * 1000),
    sevenDayResetAt: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000),
  };
  ctx.zenmuxQuota = {
    accountStatus: 'healthy',
    fiveHour: { usagePercentage: 40, resetsAt: null },
    sevenDay: { usagePercentage: 45, resetsAt: null },
  };
  ctx.transcript.lastAssistantResponseAt = new Date();
  ctx.memoryUsage = {
    totalBytes: 16 * 1024 ** 3,
    usedBytes: 8 * 1024 ** 3,
    freeBytes: 8 * 1024 ** 3,
    usedPercent: 50,
  };
  ctx.claudeMdCount = 1;
  ctx.rulesCount = 2;
  ctx.mcpCount = 3;
  ctx.hooksCount = 4;

  const originalEnvColumns = process.env.COLUMNS;
  let lines = [];
  withColumns(process.stdout, undefined, () => {
    withColumns(process.stderr, undefined, () => {
      delete process.env.COLUMNS;
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
  });

  assert.ok(lines.some(line => line.includes('Context')), 'context row should remain visible');
  assert.ok(lines.some(line => line.includes('Usage')), 'usage row should remain visible');
  assert.ok(lines.some(line => line.includes('ZenMux')), 'zenmux row should remain visible');
  assert.ok(lines.some(line => line.includes('Cache')), 'prompt cache row should remain visible');
  assert.ok(lines.some(line => line.includes('Approx RAM')), 'memory row should remain visible');
  assert.ok(lines.some(line => line.includes('CLAUDE.md')), 'environment row should remain visible');
  assert.ok(lines.every(line => displayWidth(line) <= 120), 'fallback wrapping should prevent overlong statusline rows');
});

test('width math counts ambiguous chars as 2 cells only in CJK mode', async () => {
  const { codePointCellWidth, isAmbiguousWideCodePoint, isCjkAmbiguousWide } =
    await import('../dist/render/width.js');

  assert.equal(isAmbiguousWideCodePoint(0x2588), true, '█ U+2588 is ambiguous');
  assert.equal(isAmbiguousWideCodePoint(0x2502), true, '│ U+2502 is ambiguous');
  assert.equal(isAmbiguousWideCodePoint(0x0041), false, 'ASCII A is not ambiguous');

  setLanguage('zh');
  try {
    assert.equal(isCjkAmbiguousWide(), true);
    assert.equal(codePointCellWidth(0x2588, isCjkAmbiguousWide()), 2);
    assert.equal(codePointCellWidth(0x0041, isCjkAmbiguousWide()), 1);
  } finally {
    setLanguage('en');
  }

  assert.equal(isCjkAmbiguousWide(), false);
  assert.equal(codePointCellWidth(0x2588, isCjkAmbiguousWide()), 1);
});
