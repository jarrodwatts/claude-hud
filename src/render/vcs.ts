import * as fs from 'node:fs';
import * as path from 'node:path';
import { DEFAULT_CONFIG } from '../config.js';
import type { Frame, Layout } from './frame.js';
import { critical, dim, git as gitColor, gitBranch, green, red, warning, yellow } from './colors.js';
import { getFileHref, safeHyperlink } from '../utils/hyperlinks.js';
import { sanitizeDisplayText } from '../utils/sanitize.js';

function aheadCount(f: Frame, ahead: number): string {
  const config = f.config.gitStatus ?? DEFAULT_CONFIG.gitStatus;
  const colors = f.config?.colors;
  const value = `↑${ahead}`;
  if (config.pushCriticalThreshold > 0 && ahead >= config.pushCriticalThreshold) return critical(value, colors);
  if (config.pushWarningThreshold > 0 && ahead >= config.pushWarningThreshold) return warning(value, colors);
  return gitBranch(value, colors);
}

/**
 * `git:(main* ↑2)` or `jj:(…)`, plus the worktree name. Expanded adds line diffs;
 * compact adds Starship-style file counts instead. jj never shows git-only details.
 */
export function vcsPart(f: Frame, layout: Layout): string | null {
  const status = f.gitStatus;
  if (!status) return null;
  const git = f.config.gitStatus ?? DEFAULT_CONFIG.gitStatus;
  const jj = f.config.jjStatus ?? DEFAULT_CONFIG.jjStatus;
  const isJj = status.vcs === 'jj';
  if (!(isJj ? jj.enabled : git.enabled)) return null;

  const colors = f.config?.colors;
  const dirty = (isJj ? jj.showDirty : git.showDirty) && status.isDirty;
  const branch = safeHyperlink(isJj ? undefined : status.branchUrl, gitBranch(`${sanitizeDisplayText(status.branch)}${dirty ? '*' : ''}`, colors));
  const inner = [branch];

  if (!isJj && git.showAheadBehind) {
    if (status.ahead > 0) inner.push(aheadCount(f, status.ahead));
    if (status.behind > 0) inner.push(gitBranch(`↓${status.behind}`, colors));
  }
  if (!isJj && git.showFileStats) {
    if (layout === 'expanded' && status.lineDiff) {
      const diff = [status.lineDiff.added > 0 ? green(`+${status.lineDiff.added}`) : '', status.lineDiff.deleted > 0 ? red(`-${status.lineDiff.deleted}`) : '']
        .filter(Boolean);
      if (diff.length > 0) inner.push(`[${diff.join(' ')}]`);
    }
    if (layout === 'compact' && status.fileStats) {
      const { modified, added, deleted, untracked } = status.fileStats;
      const counts = [[modified, '!'], [added, '+'], [deleted, '✘'], [untracked, '?']]
        .filter(([count]) => (count as number) > 0)
        .map(([count, symbol]) => `${symbol}${count}`);
      if (counts.length > 0) inner.push(gitBranch(counts.join(' '), colors));
    }
  }
  if (isJj && jj.showConflicts && status.conflict === true) inner.push(critical('!conflict', colors));

  const worktreeName = !isJj && git.showWorktree ? sanitizeDisplayText(f.stdin.workspace?.git_worktree ?? '').trim() : '';
  const worktree = worktreeName ? ` ${gitColor(`⎇ ${worktreeName}`, colors)}` : '';
  return `${gitColor(isJj ? 'jj:(' : 'git:(', colors)}${inner.join(' ')}${gitColor(')', colors)}${worktree}`;
}

function insideCwd(cwd: string, candidate: string): string | null {
  const resolved = path.resolve(cwd, candidate);
  const relative = path.relative(path.resolve(cwd), resolved);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)) ? resolved : null;
}

const MAX_FILES = 6;

/** Recently changed files, newest first, with per-file line diffs (expanded, gitStatus.showFileStats). */
export function gitFilesLine(f: Frame): string | null {
  const stats = f.gitStatus?.fileStats;
  if (!(f.config?.gitStatus?.showFileStats ?? false) || !stats) return null;
  if (stats.trackedFiles.length === 0 && stats.untracked === 0) return null;
  if (f.width !== null && f.width < 60) return null;

  const cwd = f.stdin.cwd;
  const mtime = (fullPath: string): number => {
    const resolved = cwd ? insideCwd(cwd, fullPath) : null;
    return resolved ? fs.statSync(resolved).mtimeMs : 0;
  };
  const sorted = [...stats.trackedFiles].sort((a, b) => {
    try {
      return mtime(b.fullPath) - mtime(a.fullPath);
    } catch {
      return 0;
    }
  });

  const colorFor = { added: green, deleted: red, modified: yellow } as const;
  const prefix = { added: '+', deleted: '-', modified: '~' } as const;
  const entries = sorted.slice(0, MAX_FILES).map((file) => {
    const color = colorFor[file.type];
    const resolved = cwd ? insideCwd(cwd, file.fullPath) : null;
    const name = color(sanitizeDisplayText(file.basename));
    let entry = `${color(prefix[file.type])}${resolved ? safeHyperlink(getFileHref(resolved), name) : name}`;
    const diff = file.lineDiff;
    const diffParts = diff ? [diff.added > 0 ? green(`+${diff.added}`) : '', diff.deleted > 0 ? red(`-${diff.deleted}`) : ''].filter(Boolean) : [];
    if (diffParts.length > 0) entry += dim(`(${diffParts.join(' ')})`);
    return entry;
  });

  if (sorted.length > MAX_FILES) entries.push(dim(`+${sorted.length - MAX_FILES} more`));
  if (stats.untracked > 0) entries.push(dim(`?${stats.untracked}`));
  return entries.join('  ');
}
