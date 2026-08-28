import { createDebug } from './debug.js';
import { createGitRunner, type GitCommandRunner } from './git-runner.js';

const debug = createDebug('git');

export interface LineDiff {
  added: number;
  deleted: number;
}

export interface TrackedFile {
  basename: string;
  fullPath: string;
  type: 'modified' | 'added' | 'deleted';
  lineDiff?: LineDiff;
}

export interface FileStats {
  modified: number;
  added: number;
  deleted: number;
  untracked: number;
  trackedFiles: TrackedFile[];
}

export interface GitStatus {
  branch: string;
  isDirty: boolean;
  ahead: number;
  behind: number;
  fileStats?: FileStats;
  lineDiff?: LineDiff;
  branchUrl?: string;
  /** Which VCS produced this status. Omitted (undefined) means 'git'. */
  vcs?: 'git' | 'jj';
  /** jj-native: true when the working-copy commit has an unresolved conflict. */
  conflict?: boolean;
}

export async function getGitBranch(cwd?: string): Promise<string | null> {
  if (!cwd) return null;

  let runner: GitCommandRunner | undefined;
  try {
    runner = createGitRunner(cwd);
    return await resolveGitRef(runner);
  } catch (err) {
    debug('Failed to get git branch:', err instanceof Error ? err.message : err);
    return null;
  } finally {
    await runner?.close();
  }
}

export async function getGitStatus(cwd?: string): Promise<GitStatus | null> {
  if (!cwd) return null;

  let runner: GitCommandRunner | undefined;
  try {
    runner = createGitRunner(cwd);
    // Get branch name
    const branch = await resolveGitRef(runner);
    if (!branch) return null;

    // Check for dirty state and parse file stats
    let isDirty = false;
    let fileStats: FileStats | undefined;
    let lineDiff: LineDiff | undefined;
    try {
      const { stdout: statusOut } = await runner.run(
        ['-c', 'core.quotePath=false', '--no-optional-locks', 'status', '--porcelain'],
        1000,
      );
      const trimmed = statusOut.trim();
      isDirty = trimmed.length > 0;
      if (isDirty) {
        fileStats = parseFileStats(trimmed);
      }
    } catch (err) {
      debug('Failed to get git status:', err instanceof Error ? err.message : err);
    }

    // Get per-file and total line diffs
    if (isDirty) {
      try {
        const { stdout: numstatOut } = await runner.run(
          ['-c', 'core.quotePath=false', '--no-optional-locks', 'diff', '--numstat', 'HEAD'],
          2000,
        );
        const trackedPaths = new Set(fileStats?.trackedFiles.map((file) => file.fullPath) ?? []);
        const { totalDiff, perFileDiff } = parseNumstat(numstatOut, trackedPaths);
        lineDiff = totalDiff;
        if (fileStats) {
          applyLineDiffsToFiles(fileStats.trackedFiles, perFileDiff);
        }
      } catch (err) {
        debug('Failed to get line diff:', err instanceof Error ? err.message : err);
      }
    }

    // Get ahead/behind counts
    let ahead = 0;
    let behind = 0;
    try {
      const { stdout: revOut } = await runner.run(
        ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'],
        1000,
      );
      const parts = revOut.trim().split(/\s+/);
      if (parts.length === 2) {
        behind = parseInt(parts[0], 10) || 0;
        ahead = parseInt(parts[1], 10) || 0;
      }
    } catch (err) {
      debug('Failed to get ahead/behind (no upstream?):', err instanceof Error ? err.message : err);
    }

    // Build GitHub branch URL from remote
    let branchUrl: string | undefined;
    try {
      const { stdout: remoteOut } = await runner.run(
        ['remote', 'get-url', 'origin'],
        1000,
      );
      const remote = remoteOut.trim();
      const httpsBase = remote
        .replace(/^git@github\.com:/, 'https://github.com/')
        .replace(/^ssh:\/\/git@github\.com\//, 'https://github.com/')
        .replace(/\.git$/, '');
      if (httpsBase.startsWith('https://github.com/')) {
        branchUrl = buildGitHubRefUrl(httpsBase, branch);
      }
    } catch (err) {
      debug('Failed to get remote URL:', err instanceof Error ? err.message : err);
    }

    return { branch, isDirty, ahead, behind, fileStats, lineDiff, branchUrl };
  } catch (err) {
    debug('getGitStatus failed:', err instanceof Error ? err.message : err);
    return null;
  } finally {
    await runner?.close();
  }
}

async function resolveGitRef(runner: GitCommandRunner): Promise<string | null> {
  const { stdout: branchOut } = await runner.run(
    ['rev-parse', '--abbrev-ref', 'HEAD'],
    1000,
  );
  const branch = branchOut.trim();
  if (branch && branch !== 'HEAD') {
    return branch;
  }

  try {
    const { stdout: tagOut } = await runner.run(
      ['describe', '--tags', '--exact-match', 'HEAD'],
      1000,
    );
    const tag = tagOut.trim();
    if (tag) return tag;
  } catch {
    // Detached commits often are not tagged; fall back to a short commit id.
  }

  const { stdout: shortShaOut } = await runner.run(
    ['rev-parse', '--short', 'HEAD'],
    1000,
  );
  const shortSha = shortShaOut.trim();
  return shortSha ? `detached:${shortSha}` : null;
}

function encodeGitHubRef(ref: string): string {
  return ref.split('/').map(encodeURIComponent).join('/');
}

function buildGitHubRefUrl(httpsBase: string, ref: string): string {
  const detachedMatch = ref.match(/^detached:([0-9a-f]+)$/);
  if (detachedMatch) {
    return `${httpsBase}/commit/${detachedMatch[1]}`;
  }

  return `${httpsBase}/tree/${encodeGitHubRef(ref)}`;
}

/**
 * Parse git status --porcelain output and count file stats (Starship-compatible format)
 * Status codes: M=modified, A=added, D=deleted, ??=untracked
 */
function parseFileStats(porcelainOutput: string): FileStats {
  const stats: FileStats = { modified: 0, added: 0, deleted: 0, untracked: 0, trackedFiles: [] };
  const lines = porcelainOutput.split('\n').filter(Boolean);

  for (const line of lines) {
    if (line.length < 2) continue;

    const index = line[0];    // staged status
    const worktree = line[1]; // unstaged status

    if (line.startsWith('??')) {
      stats.untracked++;
    } else if (index === 'A') {
      stats.added++;
      const fullPath = parsePorcelainPath(line.slice(2).trimStart());
      stats.trackedFiles.push({ basename: fullPath.split('/').pop() ?? fullPath, fullPath, type: 'added' });
    } else if (index === 'D' || worktree === 'D') {
      stats.deleted++;
      const fullPath = parsePorcelainPath(line.slice(2).trimStart());
      stats.trackedFiles.push({ basename: fullPath.split('/').pop() ?? fullPath, fullPath, type: 'deleted' });
    } else if (index === 'M' || worktree === 'M' || index === 'R' || index === 'C') {
      // M=modified, R=renamed (counts as modified), C=copied (counts as modified)
      stats.modified++;
      // For renames, git porcelain shows "old -> new"; take the destination path
      const fullPath = parsePorcelainPath(line.slice(2).trimStart().split(' -> ').pop() ?? line.slice(2).trimStart());
      stats.trackedFiles.push({ basename: fullPath.split('/').pop() ?? fullPath, fullPath, type: 'modified' });
    }
  }

  return stats;
}

function parsePorcelainPath(pathField: string): string {
  if (pathField.startsWith('"') && pathField.endsWith('"')) {
    try {
      return JSON.parse(pathField);
    } catch {
      return pathField.slice(1, -1);
    }
  }

  return pathField;
}

/**
 * Extract the destination path from a numstat path field.
 *
 * For renames, `git diff --numstat` emits the path as `old => new`
 * (sometimes with a shared directory prefix like `pkg/{old.ts => new.ts}`).
 * `git status --porcelain` reports the renamed file under its destination
 * only, so we key `perFileDiff` by the destination to make lookups match.
 */
function extractNumstatDestination(filePath: string): string {
  const braceMatch = filePath.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
  if (braceMatch) {
    const [, prefix, , dest, suffix] = braceMatch;
    return `${prefix}${dest}${suffix}`.replace(/\/{2,}/g, '/');
  }

  const arrowIndex = filePath.indexOf(' => ');
  if (arrowIndex !== -1) {
    return filePath.slice(arrowIndex + 4);
  }

  return filePath;
}

function resolveNumstatPath(filePath: string, trackedPaths: Set<string>): string {
  if (trackedPaths.has(filePath)) {
    return filePath;
  }

  const destinationPath = extractNumstatDestination(filePath);
  if (destinationPath !== filePath && trackedPaths.has(destinationPath)) {
    return destinationPath;
  }

  return filePath;
}

/**
 * Parse `git diff --numstat HEAD` output.
 * Returns total line diff and a map of fullPath -> LineDiff.
 */
function parseNumstat(numstatOutput: string, trackedPaths: Set<string>): { totalDiff: LineDiff; perFileDiff: Map<string, LineDiff> } {
  const totalDiff: LineDiff = { added: 0, deleted: 0 };
  const perFileDiff = new Map<string, LineDiff>();

  for (const line of numstatOutput.trim().split('\n').filter(Boolean)) {
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const added = parseInt(parts[0], 10);
    const deleted = parseInt(parts[1], 10);
    const filePath = resolveNumstatPath(parts[2], trackedPaths);
    if (Number.isNaN(added) || Number.isNaN(deleted)) continue; // binary file
    totalDiff.added += added;
    totalDiff.deleted += deleted;
    perFileDiff.set(filePath, { added, deleted });
  }

  return { totalDiff, perFileDiff };
}

function applyLineDiffsToFiles(files: TrackedFile[], perFileDiff: Map<string, LineDiff>): void {
  for (const file of files) {
    const diff = perFileDiff.get(file.fullPath);
    if (diff) {
      file.lineDiff = diff;
    }
  }
}
