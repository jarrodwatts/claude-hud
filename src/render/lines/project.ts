import type { RenderContext } from '../../types.js';
import { cyan, magenta, yellow } from '../colors.js';

export function renderProjectLine(ctx: RenderContext): string | null {
  if (!ctx.stdin.cwd) {
    return null;
  }

  const segments = ctx.stdin.cwd.split(/[/\\]/).filter(Boolean);
  const pathLevels = ctx.config?.pathLevels ?? 1;
  const projectPath = segments.length > 0 ? segments.slice(-pathLevels).join('/') : '/';

  let gitPart = '';
  const gitConfig = ctx.config?.gitStatus;
  const showGit = gitConfig?.enabled ?? true;

  if (showGit && ctx.gitStatus) {
    const gitParts: string[] = [ctx.gitStatus.branch];

    if ((gitConfig?.showDirty ?? true) && ctx.gitStatus.isDirty) {
      gitParts.push('*');
    }

    if (gitConfig?.showAheadBehind) {
      if (ctx.gitStatus.ahead > 0) {
        gitParts.push(` ↑${ctx.gitStatus.ahead}`);
      }
      if (ctx.gitStatus.behind > 0) {
        gitParts.push(` ↓${ctx.gitStatus.behind}`);
      }
    }

    if (gitConfig?.showFileStats && ctx.gitStatus.fileStats) {
      const { modified, added, deleted, untracked } = ctx.gitStatus.fileStats;
      const statParts: string[] = [];
      if (modified > 0) statParts.push(`!${modified}`);
      if (added > 0) statParts.push(`+${added}`);
      if (deleted > 0) statParts.push(`✘${deleted}`);
      if (untracked > 0) statParts.push(`?${untracked}`);
      if (statParts.length > 0) {
        gitParts.push(` ${statParts.join(' ')}`);
      }
    }

    gitPart = ` ${magenta('git:(')}${cyan(gitParts.join(''))}${magenta(')')}`;
  }

  return `${yellow(projectPath)}${gitPart}`;
}
