// P4: the corpus only grows. A fixture or payload may be added, never deleted, edited, renamed or
// retyped, so a fix can't pass by weakening the case that pinned the bug. One git command.
import { execFileSync } from 'node:child_process';

const base = process.env.VERIFY_BASE || `origin/${process.env.GITHUB_BASE_REF || 'main'}`;
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
const paths = ['tests/corpus', 'redteam/payloads'];
let bad;
try {
  bad = git('diff', '--name-status', '--diff-filter=DMRT', `${base}...HEAD`, '--', ...paths).trim();
} catch {
  console.log(`FAIL cannot diff against ${base}; check out with fetch-depth: 0`);
  process.exit(1);
}
if (bad) {
  console.log(`FAIL ${paths.join(' and ')} are append-only; these changed since ${base}:\n${bad}`);
  process.exit(1);
}
const added = git('diff', '--name-only', '--diff-filter=A', `${base}...HEAD`, '--', ...paths).trim();
console.log(`ok: nothing changed since ${base}; ${added ? added.split('\n').length : 0} file(s) added`);
