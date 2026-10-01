import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createDebug } from './debug.js';
import { sanitizeDisplayText } from './utils/sanitize.js';
import type { GitStatus } from './git.js';

const debug = createDebug('jj');

const MAX_WALK_DEPTH = 64;
const MAX_OUTPUT_BYTES = 16 * 1024;
const MAX_LABEL_LENGTH = 64;
const FIELD_SEPARATOR = '\x1f';
const BOOKMARK_SEPARATOR = '\x1e';

export interface JjRunnerOptions {
  cwd: string;
  timeout: number;
  maxBuffer: number;
  encoding: 'utf8';
  windowsHide: boolean;
  shell: false;
}

export type JjRunner = (file: string, args: readonly string[], options: JjRunnerOptions) => Promise<{ stdout: string }>;

const defaultRunner: JjRunner = (file, args, options) => new Promise((resolve, reject) => {
  execFile(file, [...args], options, (error, stdout) => (error ? reject(error) : resolve({ stdout })));
});

function realDirectory(cwd: string): string | null {
  try {
    const resolved = fs.realpathSync(cwd);
    return fs.lstatSync(resolved).isDirectory() ? resolved : null;
  } catch {
    return null;
  }
}

function markerType(markerPath: string): 'directory' | 'other' | null {
  try {
    return fs.lstatSync(markerPath).isDirectory() ? 'directory' : 'other';
  } catch {
    return null;
  }
}

// Walks up from cwd for a `.jj` directory, as jj does, without spawning anything. lstat
// keeps a symlinked marker from pointing jj at a directory that isn't a repo, and a
// nearer .git ends the walk so a nested Git repo never resolves to a parent jj checkout.
export function isJjRepo(cwd?: string): boolean {
  let dir = cwd ? realDirectory(cwd) : null;
  for (let depth = 0; dir && depth < MAX_WALK_DEPTH; depth++) {
    if (markerType(path.join(dir, '.jj')) === 'directory') return true;
    if (markerType(path.join(dir, '.git')) !== null) return false;
    const parent = path.dirname(dir);
    dir = parent === dir ? null : parent;
  }
  return false;
}

// change id | bookmarks at @ | dirty | conflict, from one read-only `jj log`.
const JJ_TEMPLATE = [
  'change_id.shortest(8)',
  '"\\x1f"',
  'self.local_bookmarks().map(|bookmark| bookmark.name()).join("\\x1e")',
  '"\\x1f"',
  'if(self.empty(), "0", "1")',
  '"\\x1f"',
  'if(self.conflict(), "1", "0")',
].join(' ++ ');

const JJ_ARGS = [
  '--ignore-working-copy', '--at-operation=@', '--no-pager',
  'log', '-r', '@', '--no-graph', '--color', 'never', '-T', JJ_TEMPLATE,
] as const;

// Truncates by code point so the cut can't split a surrogate pair.
function label(value: string): string | null {
  const sanitized = sanitizeDisplayText(value).trim();
  return sanitized ? Array.from(sanitized).slice(0, MAX_LABEL_LENGTH).join('') : null;
}

function parseJjOutput(stdout: string): GitStatus | null {
  const output = stdout.replace(/\r?\n$/, '');
  const fields = output.split(FIELD_SEPARATOR);
  if (/[\r\n]/.test(output) || fields.length !== 4) return null;

  const [changeId, bookmarkList, dirty, conflict] = fields;
  if (!['0', '1'].includes(dirty) || !['0', '1'].includes(conflict)) return null;
  const bookmarks = bookmarkList === '' ? [] : bookmarkList.split(BOOKMARK_SEPARATOR);
  if (!label(changeId) || bookmarks.some((bookmark) => bookmark === '')) return null;

  const branch = label(bookmarks[0] ?? changeId);
  return branch
    ? { branch, isDirty: dirty === '1', ahead: 0, behind: 0, vcs: 'jj', conflict: conflict === '1' }
    : null;
}

export async function getJjStatus(cwd?: string, runner: JjRunner = defaultRunner): Promise<GitStatus | null> {
  const resolvedCwd = cwd ? realDirectory(cwd) : null;
  if (!resolvedCwd) return null;
  try {
    const { stdout } = await runner('jj', JJ_ARGS, {
      cwd: resolvedCwd,
      timeout: 2000,
      maxBuffer: MAX_OUTPUT_BYTES,
      encoding: 'utf8',
      windowsHide: true,
      shell: false,
    });
    return parseJjOutput(stdout);
  } catch (err) {
    // jj missing, not a repo, or a template this jj version rejects: render nothing.
    debug('getJjStatus failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
