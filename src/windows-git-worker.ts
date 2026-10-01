// Usage: node windows-git-worker.js <absolute git path> <cwd> <git args...>
// Git writes straight to the stdout pipe this worker inherited from its parent.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createGitEnvironment, terminateWindowsProcessTree } from './git-runner.js';

const [gitExecutable, cwd, ...args] = process.argv.slice(2);
const gitName = path.basename(gitExecutable ?? '').toLowerCase();

if (!gitExecutable || gitExecutable.includes('\0') || !path.isAbsolute(gitExecutable)
  || (gitName !== 'git' && gitName !== 'git.exe') || !cwd) {
  process.exit(2);
}

const git = spawn(gitExecutable, args, {
  cwd,
  env: createGitEnvironment(),
  windowsHide: true,
  shell: false,
  stdio: ['ignore', 'inherit', 'ignore'],
});

git.once('error', () => process.exit(1));
git.once('exit', (code) => process.exit(code ?? 1));
process.once('disconnect', () => {
  void terminateWindowsProcessTree(git).finally(() => process.exit(1));
});
