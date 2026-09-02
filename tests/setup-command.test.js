import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readSetup = () => readFile(new URL('../commands/setup.md', import.meta.url), 'utf8');

// Match the headings, not the cross-references the prose makes to them.
function windowsGitBashSection(setup) {
  const start = setup.indexOf('**Windows + Git Bash** (Platform:');
  const end = setup.indexOf('**Windows + PowerShell** (Platform:', start);
  assert.ok(start !== -1 && end > start, 'Windows + Git Bash section not found');
  return setup.slice(start, end);
}

test('setup commands silence /dev/tty failures before opening the device', async () => {
  const setup = await readSetup();

  assert.doesNotMatch(setup, /stty size <\/dev\/tty 2>\/dev\/null/);
  assert.equal(setup.match(/stty size 2>\/dev\/null <\/dev\/tty/g)?.length, 3);
});

test('the Windows Git Bash statusline execs a cmd.exe shim, not the runtime', async () => {
  const gitBash = windowsGitBashSection(await readSetup());

  // Git Bash creates every native child suspended and resumes it a moment
  // later. A statusLine shell killed inside that window strands whatever it
  // was starting: the child never runs, so it never exits either. Stranding a
  // ~2 MB cmd.exe stub is survivable; stranding the ~36 MB node.exe runtime is
  // what filled machines in #747, one process per lost render.
  assert.doesNotMatch(gitBash, /exec "\{RUNTIME_PATH\}"/);
  assert.match(
    gitBash,
    /exec "\$\{CLAUDE_CONFIG_DIR:-\$HOME\/\.claude\}\/plugins\/claude-hud\/statusline\.cmd"/,
  );
});

test('the Windows Git Bash command exports the raw terminal width', async () => {
  const gitBash = windowsGitBashSection(await readSetup());

  // statusline.mjs subtracts the 4 columns of Claude Code padding itself, so
  // the shell must hand it the untouched width or the HUD renders 8 short.
  assert.match(gitBash, /export COLUMNS="\$cols"/);
  assert.doesNotMatch(gitBash, /export COLUMNS=\$\(\( cols > 4/);
});

test('the Windows Git Bash shim keeps the runtime path out of the printf format', async () => {
  const gitBash = windowsGitBashSection(await readSetup());

  // printf expands backslash escapes in its format string, so an inlined
  // C:\Program Files\nodejs\node.exe would break the file at \n. The path
  // belongs in a %s argument, and batch files need CRLF.
  assert.match(gitBash, /printf '@echo off\\r\\n"%s" "%%~dp0statusline\.mjs"\\r\\n' "\{RUNTIME_PATH_WIN\}"/);
});
