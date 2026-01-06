import type { RenderContext } from '../types.js';
import { cyan, dim, magenta, yellow } from './colors.js';

export function renderProjectLine(ctx: RenderContext): string | null {
  const parts: string[] = [];

  // Show project path (configurable path levels, default 1)
  if (ctx.stdin.cwd) {
    // Split by both Unix (/) and Windows (\) separators for cross-platform support
    const segments = ctx.stdin.cwd.split(/[/\\]/).filter(Boolean);
    const pathLevels = ctx.config?.pathLevels ?? 1;
    // Always join with forward slash for consistent display
    // Fallback to '/' for root path (when segments is empty)
    const projectPath = segments.slice(-pathLevels).join('/') || '/';

    // Build git status string
    let gitPart = '';
    const gitConfig = ctx.config?.gitStatus;
    const showGit = gitConfig?.enabled ?? true;

    if (showGit && ctx.gitStatus) {
      const gitParts: string[] = [ctx.gitStatus.branch];

      // Show dirty indicator
      if ((gitConfig?.showDirty ?? true) && ctx.gitStatus.isDirty) {
        gitParts.push('*');
      }

      // Show ahead/behind (with space prefix for visual separation)
      if (gitConfig?.showAheadBehind) {
        if (ctx.gitStatus.ahead > 0) {
          gitParts.push(` ↑${ctx.gitStatus.ahead}`);
        }
        if (ctx.gitStatus.behind > 0) {
          gitParts.push(` ↓${ctx.gitStatus.behind}`);
        }
      }

      gitPart = ` ${magenta('git:(')}${cyan(gitParts.join(''))}${magenta(')')}`;
    }

    parts.push(`📁 ${yellow(projectPath)}${gitPart}`);
  }

  const display = ctx.config?.display;

  // Config counts
  if (display?.showConfigCounts !== false) {
    if (ctx.claudeMdCount > 0) {
      parts.push(dim(`${ctx.claudeMdCount} CLAUDE.md`));
    }

    if (ctx.rulesCount > 0) {
      parts.push(dim(`${ctx.rulesCount} rules`));
    }

    if (ctx.mcpCount > 0) {
      parts.push(dim(`${ctx.mcpCount} MCPs`));
    }

    if (ctx.hooksCount > 0) {
      parts.push(dim(`${ctx.hooksCount} hooks`));
    }
  }

  if (parts.length === 0) {
    return null;
  }

  return parts.join(' | ');
}
