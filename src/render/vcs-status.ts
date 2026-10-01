import { DEFAULT_CONFIG } from '../config.js';
import type { HudConfig, GitBranchOverflowMode } from '../config.js';
import type { GitStatus, FileStats, LineDiff } from '../git.js';
import { sanitizeDisplayText } from '../utils/sanitize.js';

export interface VcsDisplayState {
  kind: 'git' | 'jj';
  branch: string;
  dirty: boolean;
  conflict: boolean;
  ahead: number;
  behind: number;
  fileStats?: FileStats;
  lineDiff?: LineDiff;
  branchUrl?: string;
  // Linked worktree name, from stdin workspace.git_worktree.
  worktree?: string;
  branchOverflow: GitBranchOverflowMode;
}

/**
 * Resolve VCS-specific visibility once so compact and expanded layouts cannot
 * drift. jj never inherits Git-only ahead/behind or file-stat settings.
 */
export function getVcsDisplayState(
  status: GitStatus | null,
  config: Pick<Partial<HudConfig>, 'gitStatus' | 'jjStatus'>,
  gitWorktree?: string,
): VcsDisplayState | null {
  if (!status) return null;

  const kind = status.vcs === 'jj' ? 'jj' : 'git';
  const gitConfig = config.gitStatus ?? DEFAULT_CONFIG.gitStatus;
  const jjConfig = config.jjStatus ?? DEFAULT_CONFIG.jjStatus;
  const enabled = kind === 'jj' ? jjConfig.enabled : gitConfig.enabled;
  if (!enabled) return null;

  const showDirty = kind === 'jj' ? jjConfig.showDirty : gitConfig.showDirty;
  const isGit = kind === 'git';

  return {
    kind,
    branch: sanitizeDisplayText(status.branch),
    dirty: showDirty && status.isDirty,
    conflict: kind === 'jj' && jjConfig.showConflicts && status.conflict === true,
    ahead: isGit && gitConfig.showAheadBehind ? status.ahead : 0,
    behind: isGit && gitConfig.showAheadBehind ? status.behind : 0,
    fileStats: isGit && gitConfig.showFileStats ? status.fileStats : undefined,
    lineDiff: isGit && gitConfig.showFileStats ? status.lineDiff : undefined,
    branchUrl: isGit ? status.branchUrl : undefined,
    worktree: isGit && gitConfig.showWorktree && gitWorktree
      ? sanitizeDisplayText(gitWorktree).trim() || undefined
      : undefined,
    branchOverflow: gitConfig.branchOverflow,
  };
}
