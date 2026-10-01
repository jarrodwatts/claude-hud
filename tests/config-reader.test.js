import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, symlink, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as fs from 'node:fs';
import { countConfigs } from '../dist/config-reader.js';

function restoreEnvVar(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

test('countConfigs honors project and global config locations', async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-home-'));
  const projectDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-project-'));
  const originalHome = process.env.HOME;
  process.env.HOME = homeDir;

  try {
    await mkdir(path.join(homeDir, '.claude', 'rules', 'nested'), { recursive: true });
    await writeFile(path.join(homeDir, '.claude', 'CLAUDE.md'), 'global', 'utf8');
    await writeFile(path.join(homeDir, '.claude', 'rules', 'rule.md'), '# rule', 'utf8');
    await writeFile(path.join(homeDir, '.claude', 'rules', 'nested', 'rule-nested.md'), '# rule nested', 'utf8');
    await writeFile(
      path.join(homeDir, '.claude', 'settings.json'),
      JSON.stringify({ mcpServers: { one: {} }, hooks: { onStart: {} } }),
      'utf8'
    );
    await writeFile(path.join(homeDir, '.claude.json'), '{bad json', 'utf8');

    await mkdir(path.join(projectDir, '.claude', 'rules'), { recursive: true });
    await writeFile(path.join(projectDir, 'CLAUDE.md'), 'project', 'utf8');
    await writeFile(path.join(projectDir, 'CLAUDE.local.md'), 'project-local', 'utf8');
    await writeFile(path.join(projectDir, '.claude', 'CLAUDE.md'), 'project-alt', 'utf8');
    await writeFile(path.join(projectDir, '.claude', 'CLAUDE.local.md'), 'project-alt-local', 'utf8');
    await writeFile(path.join(projectDir, '.claude', 'rules', 'rule2.md'), '# rule2', 'utf8');
    await writeFile(
      path.join(projectDir, '.claude', 'settings.json'),
      JSON.stringify({ mcpServers: { two: {}, three: {} }, hooks: { onStop: {} } }),
      'utf8'
    );
    await writeFile(path.join(projectDir, '.claude', 'settings.local.json'), '{bad json', 'utf8');
    await writeFile(path.join(projectDir, '.mcp.json'), JSON.stringify({ mcpServers: { four: {} } }), 'utf8');

    const counts = await countConfigs(projectDir);
    assert.equal(counts.claudeMdCount, 5);
    assert.equal(counts.rulesCount, 3);
    assert.equal(counts.mcpCount, 4);
    assert.equal(counts.hooksCount, 2);
  } finally {
    process.env.HOME = originalHome;
    await rm(homeDir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  }
});

test('countConfigs uses CLAUDE_CONFIG_DIR and its in-dir .claude.json for user scope', async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-home-'));
  const customConfigDir = path.join(homeDir, '.claude-2');
  const originalHome = process.env.HOME;
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
  process.env.HOME = homeDir;
  process.env.CLAUDE_CONFIG_DIR = customConfigDir;

  try {
    // Default directory should be ignored when CLAUDE_CONFIG_DIR is set.
    await mkdir(path.join(homeDir, '.claude', 'rules'), { recursive: true });
    await writeFile(path.join(homeDir, '.claude', 'CLAUDE.md'), 'default-global', 'utf8');
    await writeFile(path.join(homeDir, '.claude', 'rules', 'rule.md'), '# default rule', 'utf8');
    await writeFile(
      path.join(homeDir, '.claude', 'settings.json'),
      JSON.stringify({ mcpServers: { defaultA: {} }, hooks: { onDefault: {} } }),
      'utf8'
    );
    await writeFile(path.join(homeDir, '.claude.json'), JSON.stringify({ disabledMcpServers: ['defaultA'] }), 'utf8');

    // Custom config directory and its in-dir .claude.json should drive user-scope counts.
    await mkdir(customConfigDir, { recursive: true });
    await writeFile(path.join(customConfigDir, 'CLAUDE.md'), 'custom-global', 'utf8');
    await writeFile(
      path.join(customConfigDir, 'settings.json'),
      JSON.stringify({
        mcpServers: { customA: {}, customB: {} },
        hooks: { onStart: {}, onStop: {} },
      }),
      'utf8'
    );
    await writeFile(
      path.join(customConfigDir, '.claude.json'),
      JSON.stringify({ disabledMcpServers: ['customA'] }),
      'utf8'
    );

    const counts = await countConfigs();
    assert.equal(counts.claudeMdCount, 1);
    assert.equal(counts.rulesCount, 0);
    assert.equal(counts.mcpCount, 1);
    assert.equal(counts.hooksCount, 2);
  } finally {
    restoreEnvVar('HOME', originalHome);
    restoreEnvVar('CLAUDE_CONFIG_DIR', originalConfigDir);
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('countConfigs still counts project .claude when cwd is home and CLAUDE_CONFIG_DIR points elsewhere', async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-home-'));
  const customConfigDir = path.join(homeDir, '.claude-2');
  const originalHome = process.env.HOME;
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
  process.env.HOME = homeDir;
  process.env.CLAUDE_CONFIG_DIR = customConfigDir;

  try {
    // User scope: custom config directory
    await mkdir(path.join(customConfigDir, 'rules'), { recursive: true });
    await writeFile(path.join(customConfigDir, 'CLAUDE.md'), 'custom-global', 'utf8');
    await writeFile(path.join(customConfigDir, 'rules', 'user-rule.md'), '# user rule', 'utf8');
    await writeFile(
      path.join(customConfigDir, 'settings.json'),
      JSON.stringify({ mcpServers: { userServer: {} }, hooks: { onUser: {} } }),
      'utf8'
    );

    // Project scope: cwd is home directory with its own .claude contents
    await mkdir(path.join(homeDir, '.claude', 'rules'), { recursive: true });
    await writeFile(path.join(homeDir, '.claude', 'CLAUDE.md'), 'project-alt', 'utf8');
    await writeFile(path.join(homeDir, '.claude', 'rules', 'project-rule.md'), '# project rule', 'utf8');
    await writeFile(
      path.join(homeDir, '.claude', 'settings.json'),
      JSON.stringify({ mcpServers: { projectServer: {} }, hooks: { onProject: {} } }),
      'utf8'
    );

    const counts = await countConfigs(homeDir);
    assert.equal(counts.claudeMdCount, 2);
    assert.equal(counts.rulesCount, 2);
    assert.equal(counts.mcpCount, 2);
    assert.equal(counts.hooksCount, 2);
  } finally {
    restoreEnvVar('HOME', originalHome);
    restoreEnvVar('CLAUDE_CONFIG_DIR', originalConfigDir);
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('countConfigs avoids home cwd double-counting across counters and keeps CLAUDE.local.md', async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-home-'));
  const originalHome = process.env.HOME;
  process.env.HOME = homeDir;

  try {
    await mkdir(path.join(homeDir, '.claude', 'rules'), { recursive: true });
    await writeFile(path.join(homeDir, '.claude', 'CLAUDE.md'), 'global', 'utf8');
    await writeFile(path.join(homeDir, '.claude', 'CLAUDE.local.md'), 'global-local', 'utf8');
    await writeFile(path.join(homeDir, '.claude', 'rules', 'rule.md'), '# rule', 'utf8');
    await writeFile(
      path.join(homeDir, '.claude', 'settings.json'),
      JSON.stringify({ mcpServers: { one: {} }, hooks: { onStart: {} } }),
      'utf8'
    );

    const exactCounts = await countConfigs(homeDir);
    assert.equal(exactCounts.claudeMdCount, 2);
    assert.equal(exactCounts.rulesCount, 1);
    assert.equal(exactCounts.mcpCount, 1);
    assert.equal(exactCounts.hooksCount, 1);

    const trailingSlashCounts = await countConfigs(`${homeDir}${path.sep}`);
    assert.equal(trailingSlashCounts.claudeMdCount, 2);
    assert.equal(trailingSlashCounts.rulesCount, 1);
    assert.equal(trailingSlashCounts.mcpCount, 1);
    assert.equal(trailingSlashCounts.hooksCount, 1);
  } finally {
    process.env.HOME = originalHome;
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('countConfigs excludes disabled user-scope MCPs', async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-home-'));
  const originalHome = process.env.HOME;
  process.env.HOME = homeDir;

  try {
    await mkdir(path.join(homeDir, '.claude'), { recursive: true });
    // 3 MCPs defined in settings.json
    await writeFile(
      path.join(homeDir, '.claude', 'settings.json'),
      JSON.stringify({ mcpServers: { server1: {}, server2: {}, server3: {} } }),
      'utf8'
    );
    // 1 MCP disabled in ~/.claude.json
    await writeFile(
      path.join(homeDir, '.claude.json'),
      JSON.stringify({ disabledMcpServers: ['server2'] }),
      'utf8'
    );

    const counts = await countConfigs();
    assert.equal(counts.mcpCount, 2); // 3 - 1 disabled = 2
  } finally {
    process.env.HOME = originalHome;
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('countConfigs excludes disabled project .mcp.json servers', async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-home-'));
  const projectDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-project-'));
  const originalHome = process.env.HOME;
  process.env.HOME = homeDir;

  try {
    await mkdir(path.join(homeDir, '.claude'), { recursive: true });
    await mkdir(path.join(projectDir, '.claude'), { recursive: true });

    // 4 MCPs in .mcp.json
    await writeFile(
      path.join(projectDir, '.mcp.json'),
      JSON.stringify({ mcpServers: { mcp1: {}, mcp2: {}, mcp3: {}, mcp4: {} } }),
      'utf8'
    );
    // 2 disabled via disabledMcpjsonServers
    await writeFile(
      path.join(projectDir, '.claude', 'settings.local.json'),
      JSON.stringify({ disabledMcpjsonServers: ['mcp2', 'mcp4'] }),
      'utf8'
    );

    const counts = await countConfigs(projectDir);
    assert.equal(counts.mcpCount, 2); // 4 - 2 disabled = 2
  } finally {
    process.env.HOME = originalHome;
    await rm(homeDir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  }
});

test('countConfigs handles all MCPs disabled', async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-home-'));
  const originalHome = process.env.HOME;
  process.env.HOME = homeDir;

  try {
    await mkdir(path.join(homeDir, '.claude'), { recursive: true });
    // 2 MCPs defined
    await writeFile(
      path.join(homeDir, '.claude', 'settings.json'),
      JSON.stringify({ mcpServers: { serverA: {}, serverB: {} } }),
      'utf8'
    );
    // Both disabled
    await writeFile(
      path.join(homeDir, '.claude.json'),
      JSON.stringify({ disabledMcpServers: ['serverA', 'serverB'] }),
      'utf8'
    );

    const counts = await countConfigs();
    assert.equal(counts.mcpCount, 0); // All disabled
  } finally {
    process.env.HOME = originalHome;
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('countConfigs tolerates rule directory read errors', async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-home-'));
  const originalHome = process.env.HOME;
  process.env.HOME = homeDir;

  const rulesDir = path.join(homeDir, '.claude', 'rules');
  await mkdir(rulesDir, { recursive: true });
  fs.chmodSync(rulesDir, 0);

  try {
    const counts = await countConfigs();
    assert.equal(counts.rulesCount, 0);
  } finally {
    fs.chmodSync(rulesDir, 0o755);
    process.env.HOME = originalHome;
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('countConfigs follows symlinked rule files and directories safely', async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-home-'));
  const projectDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-project-'));
  const sharedDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-rules-'));
  const originalHome = process.env.HOME;
  process.env.HOME = homeDir;

  try {
    const rulesDir = path.join(projectDir, '.claude', 'rules');
    await mkdir(rulesDir, { recursive: true });
    await writeFile(path.join(sharedDir, 'shared.md'), '# shared', 'utf8');
    await writeFile(path.join(sharedDir, 'direct.md'), '# direct', 'utf8');
    fs.symlinkSync(sharedDir, path.join(rulesDir, 'pack'), 'dir');
    fs.symlinkSync(path.join(sharedDir, 'direct.md'), path.join(rulesDir, 'linked.md'), 'file');

    const counts = await countConfigs(projectDir);
    assert.equal(counts.rulesCount, 2);

    const statBefore = fs.statSync(sharedDir);
    await writeFile(path.join(sharedDir, 'added.md'), '# added', 'utf8');
    fs.utimesSync(sharedDir, statBefore.atimeMs / 1000 + 1, statBefore.mtimeMs / 1000 + 1);
    const updated = await countConfigs(projectDir);
    assert.equal(updated.rulesCount, 3, 'cache should invalidate when a symlink target changes');
  } finally {
    process.env.HOME = originalHome;
    await rm(homeDir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
    await rm(sharedDir, { recursive: true, force: true });
  }
});

test('countConfigs skips dangling links, cycles, and duplicate symlink targets', async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-home-'));
  const projectDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-project-'));
  const sharedDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-rules-'));
  const originalHome = process.env.HOME;
  process.env.HOME = homeDir;

  try {
    const rulesDir = path.join(projectDir, '.claude', 'rules');
    await mkdir(rulesDir, { recursive: true });
    await writeFile(path.join(sharedDir, 'one.md'), '# one', 'utf8');
    fs.symlinkSync(sharedDir, path.join(rulesDir, 'pack-a'), 'dir');
    fs.symlinkSync(sharedDir, path.join(rulesDir, 'pack-b'), 'dir');
    fs.symlinkSync(rulesDir, path.join(sharedDir, 'cycle'), 'dir');
    fs.symlinkSync(path.join(sharedDir, 'missing.md'), path.join(rulesDir, 'dangling.md'), 'file');

    const counts = await countConfigs(projectDir);
    assert.equal(counts.rulesCount, 1);
  } finally {
    process.env.HOME = originalHome;
    await rm(homeDir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
    await rm(sharedDir, { recursive: true, force: true });
  }
});

test('countConfigs ignores non-string values in disabledMcpServers', async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-home-'));
  const originalHome = process.env.HOME;
  process.env.HOME = homeDir;

  try {
    await mkdir(path.join(homeDir, '.claude'), { recursive: true });
    // 3 MCPs defined
    await writeFile(
      path.join(homeDir, '.claude', 'settings.json'),
      JSON.stringify({ mcpServers: { server1: {}, server2: {}, server3: {} } }),
      'utf8'
    );
    // disabledMcpServers contains mixed types - only 'server2' is a valid string
    await writeFile(
      path.join(homeDir, '.claude.json'),
      JSON.stringify({ disabledMcpServers: [123, null, 'server2', { name: 'server3' }, [], true] }),
      'utf8'
    );

    const counts = await countConfigs();
    assert.equal(counts.mcpCount, 2); // Only 'server2' disabled, server1 and server3 remain
  } finally {
    process.env.HOME = originalHome;
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('countConfigs counts same-named servers in different scopes separately', async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-home-'));
  const projectDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-project-'));
  const originalHome = process.env.HOME;
  process.env.HOME = homeDir;

  try {
    await mkdir(path.join(homeDir, '.claude'), { recursive: true });
    await mkdir(path.join(projectDir, '.claude'), { recursive: true });

    // User scope: server named 'shared-server'
    await writeFile(
      path.join(homeDir, '.claude', 'settings.json'),
      JSON.stringify({ mcpServers: { 'shared-server': {}, 'user-only': {} } }),
      'utf8'
    );

    // Project scope: also has 'shared-server' (different config, same name)
    await writeFile(
      path.join(projectDir, '.mcp.json'),
      JSON.stringify({ mcpServers: { 'shared-server': {}, 'project-only': {} } }),
      'utf8'
    );

    const counts = await countConfigs(projectDir);
    // 'shared-server' counted in BOTH scopes (user + project) = 4 total
    assert.equal(counts.mcpCount, 4);
  } finally {
    process.env.HOME = originalHome;
    await rm(homeDir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  }
});

test('countConfigs uses case-sensitive matching for disabled servers', async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-home-'));
  const originalHome = process.env.HOME;
  process.env.HOME = homeDir;

  try {
    await mkdir(path.join(homeDir, '.claude'), { recursive: true });
    // MCP named 'MyServer' (mixed case)
    await writeFile(
      path.join(homeDir, '.claude', 'settings.json'),
      JSON.stringify({ mcpServers: { MyServer: {}, otherServer: {} } }),
      'utf8'
    );
    // Try to disable with wrong case - should NOT work
    await writeFile(
      path.join(homeDir, '.claude.json'),
      JSON.stringify({ disabledMcpServers: ['myserver', 'MYSERVER', 'OTHERSERVER'] }),
      'utf8'
    );

    const counts = await countConfigs();
    // Both servers should still be enabled (case mismatch means not disabled)
    assert.equal(counts.mcpCount, 2);
  } finally {
    process.env.HOME = originalHome;
    await rm(homeDir, { recursive: true, force: true });
  }
});

// Regression test for GitHub Issue #3:
// "MCP count showing 5 when user has 6, still showing 5 when all disabled"
// https://github.com/jarrodwatts/claude-hud/issues/3

test('Issue #3: MCP count updates correctly when servers are disabled', async () => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-home-'));
  const originalHome = process.env.HOME;
  process.env.HOME = homeDir;

  try {
    await mkdir(path.join(homeDir, '.claude'), { recursive: true });

    // User has 6 MCPs configured (simulating the issue reporter's setup)
    await writeFile(
      path.join(homeDir, '.claude.json'),
      JSON.stringify({
        mcpServers: {
          mcp1: { command: 'cmd1' },
          mcp2: { command: 'cmd2' },
          mcp3: { command: 'cmd3' },
          mcp4: { command: 'cmd4' },
          mcp5: { command: 'cmd5' },
          mcp6: { command: 'cmd6' },
        },
      }),
      'utf8'
    );

    // Scenario 1: No servers disabled - should show 6
    let counts = await countConfigs();
    assert.equal(counts.mcpCount, 6, 'Should show all 6 MCPs when none disabled');

    // Scenario 2: 1 server disabled - should show 5 (this was the initial bug report state)
    await writeFile(
      path.join(homeDir, '.claude.json'),
      JSON.stringify({
        mcpServers: {
          mcp1: { command: 'cmd1' },
          mcp2: { command: 'cmd2' },
          mcp3: { command: 'cmd3' },
          mcp4: { command: 'cmd4' },
          mcp5: { command: 'cmd5' },
          mcp6: { command: 'cmd6' },
        },
        disabledMcpServers: ['mcp1'],
      }),
      'utf8'
    );
    counts = await countConfigs();
    assert.equal(counts.mcpCount, 5, 'Should show 5 MCPs when 1 is disabled');

    // Scenario 3: ALL servers disabled - should show 0 (this was the main bug)
    await writeFile(
      path.join(homeDir, '.claude.json'),
      JSON.stringify({
        mcpServers: {
          mcp1: { command: 'cmd1' },
          mcp2: { command: 'cmd2' },
          mcp3: { command: 'cmd3' },
          mcp4: { command: 'cmd4' },
          mcp5: { command: 'cmd5' },
          mcp6: { command: 'cmd6' },
        },
        disabledMcpServers: ['mcp1', 'mcp2', 'mcp3', 'mcp4', 'mcp5', 'mcp6'],
      }),
      'utf8'
    );
    counts = await countConfigs();
    assert.equal(counts.mcpCount, 0, 'Should show 0 MCPs when all are disabled');
  } finally {
    process.env.HOME = originalHome;
    await rm(homeDir, { recursive: true, force: true });
  }
});

// === Config cache tests ===

async function getConfigCacheDir(configDir) {
  return path.join(configDir, 'plugins', 'claude-hud', 'config-cache');
}
