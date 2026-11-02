import { createDebug } from './debug.ts';
import { displayLabel } from './utils/sanitize.ts';
import type { Ask } from './channel.ts';
import type { GitStatus } from './git.ts';

const debug = createDebug('jj');

const MAX_LABEL_LENGTH = 64;
const FIELD_SEPARATOR = '\x1f';
const BOOKMARK_SEPARATOR = '\x1e';

function label(value: string): string | null {
  return displayLabel(value, MAX_LABEL_LENGTH) || null;
}

// change id | bookmarks at @ | dirty | conflict, from the one read-only `jj log` in collector.mjs.
export function parseJjOutput(stdout: string): GitStatus | null {
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

/** Null outside a jj repo, or when jj is missing or rejects the template: render nothing. */
export async function getJjStatus(ask: Ask): Promise<GitStatus | null> {
  const { jj } = await ask(['jj']);
  if (typeof jj !== 'string') {
    debug('no jj status');
    return null;
  }
  return parseJjOutput(jj);
}
