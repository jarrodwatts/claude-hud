// The one pinned Claude Code, used by the e2e check and by the maintainer's harness. The tarball's
// sha256 is checked before anything in it runs. Bumping the pin is an owner change to this file.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const CLAUDE_CODE = {
  version: '2.1.310',
  package: '@anthropic-ai/claude-code-linux-x64',
  sha256: '8c90b0170d08fdb370db282c61d74897b834fc2569dd14c35eb1e491212dc6de',
};

/** Downloads the pinned tarball into `dir` (no install scripts run), checks it, and returns the path of the `claude` binary in `dir`. */
export function installClaudeCode(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const tgz = path.join(dir, `anthropic-ai-claude-code-linux-x64-${CLAUDE_CODE.version}.tgz`);
  if (!fs.existsSync(tgz)) {
    execFileSync('npm', ['pack', '--silent', '--pack-destination', dir, `${CLAUDE_CODE.package}@${CLAUDE_CODE.version}`], { stdio: ['ignore', 'ignore', 'inherit'] });
  }
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(tgz)).digest('hex');
  if (sha256 !== CLAUDE_CODE.sha256) throw new Error(`Claude Code ${CLAUDE_CODE.version}: checksum ${sha256} is not the pinned ${CLAUDE_CODE.sha256}`);
  execFileSync('tar', ['-xzf', tgz, '-C', dir, '--strip-components=1', 'package/claude']);
  return path.join(dir, 'claude');
}
