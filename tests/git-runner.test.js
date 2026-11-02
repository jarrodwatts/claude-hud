import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  GIT_MAX_OUTPUT_BYTES,
  GitTimeoutError,
  createGitEnvironment,
  resolveWindowsExecutable,
  runGit,
  runGitInWorker,
  terminateWindowsProcessTree,
} from '../collector.mjs';

const SLOW = ['-c', 'alias.slow=!sleep 5', 'slow'];

// A timed-out git is tree-killed asynchronously, and Windows locks a running
// process's cwd. Retrying for ~3s, short of the 5s sleep, also proves the kill.
const removeOnceReleased = (dir) => rm(dir, { recursive: true, force: true, maxRetries: 15, retryDelay: 200 });

function absoluteGit() {
  return process.platform === 'win32'
    ? resolveWindowsExecutable('git')
    : execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
}

test('Git subprocess environment disables prompts and optional locks', () => {
  const environment = createGitEnvironment({
    PATH: '/example/bin',
    GIT_OPTIONAL_LOCKS: '1',
    GIT_TERMINAL_PROMPT: '1',
    GCM_INTERACTIVE: 'Always',
  });

  assert.equal(environment.PATH, '/example/bin');
  assert.equal(environment.GIT_OPTIONAL_LOCKS, '0');
  assert.equal(environment.GIT_TERMINAL_PROMPT, '0');
  assert.equal(environment.GCM_INTERACTIVE, 'Never');
  assert.equal(GIT_MAX_OUTPUT_BYTES, 1024 * 1024);
});

test('Windows tree termination targets only the owned child PID without a shell', async () => {
  const killer = new EventEmitter();
  killer.kill = () => true;
  let invocation;
  let fallbackKills = 0;
  const child = {
    pid: 4242,
    exitCode: null,
    signalCode: null,
    kill: () => {
      fallbackKills++;
      return true;
    },
  };

  const termination = terminateWindowsProcessTree(
    child,
    (file, args, options) => {
      invocation = { file, args, options };
      queueMicrotask(() => killer.emit('exit', 0, null));
      return killer;
    },
    { SystemRoot: 'C:\\Windows' },
  );

  await termination;
  assert.deepEqual(invocation, {
    file: 'C:\\Windows\\System32\\taskkill.exe',
    args: ['/PID', '4242', '/T', '/F'],
    options: { windowsHide: true, shell: false, stdio: 'ignore' },
  });
  assert.equal(fallbackKills, 0);
});

test('Windows tree termination falls back to the exact child when SystemRoot is unsafe', async () => {
  let spawnCalls = 0;
  let fallbackKills = 0;
  const child = {
    pid: 4242,
    exitCode: null,
    signalCode: null,
    kill: () => {
      fallbackKills++;
      return true;
    },
  };

  await terminateWindowsProcessTree(
    child,
    () => {
      spawnCalls++;
      throw new Error('must not run');
    },
    { SystemRoot: '.\\repo-controlled' },
  );

  assert.equal(spawnCalls, 0);
  assert.equal(fallbackKills, 1);
});

test('runGit returns stdout and rejects on failure', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-git-runner-'));
  try {
    assert.match(await runGit(dir, ['--version'], 10_000), /^git version /);
    await assert.rejects(runGit(dir, ['rev-parse', 'HEAD'], 10_000), (err) => !(err instanceof GitTimeoutError));
    await assert.rejects(runGit(dir, SLOW, 200), GitTimeoutError);
  } finally {
    await removeOnceReleased(dir);
  }
});

test('the git worker relays stdout, exit status, and times out by disconnecting', async () => {
  const git = absoluteGit();
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-git-worker-'));
  try {
    assert.match(await runGitInWorker(git, dir, ['--version'], 10_000), /^git version /);
    await assert.rejects(runGitInWorker(git, dir, ['rev-parse', 'HEAD'], 10_000), /exited with code/);
    await assert.rejects(runGitInWorker('relative/git', dir, ['--version'], 10_000), /exited with code 2/);

    const started = Date.now();
    await assert.rejects(runGitInWorker(git, dir, SLOW, 300), GitTimeoutError);
    assert.ok(Date.now() - started < 4000, 'gave up before the slow command finished');
  } finally {
    await removeOnceReleased(dir);
  }
});
