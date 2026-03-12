import type { RenderContext } from '../../types.js';
import { getModelName, getProviderLabel } from '../../stdin.js';
import { cyan, dim, magenta, yellow, red } from '../colors.js';

export function renderProjectLine(ctx: RenderContext): string | null {
  const display = ctx.config?.display;
  const parts: string[] = [];

  if (display?.showModel !== false) {
    const model = getModelName(ctx.stdin);
    const providerLabel = getProviderLabel(ctx.stdin);
    const showUsage = display?.showUsage !== false;
    const planName = showUsage ? ctx.usageData?.planName : undefined;
    const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
    const billingLabel = showUsage ? (planName ?? (hasApiKey ? red('API') : undefined)) : undefined;
    const planDisplay = providerLabel ?? billingLabel;
    const modelDisplay = planDisplay ? `${model} | ${planDisplay}` : model;
    parts.push(cyan(`[${modelDisplay}]`));
  }

  let projectPart: string | null = null;
  if (display?.showProject !== false && ctx.stdin.cwd) {
    const segments = ctx.stdin.cwd.split(/[/\\]/).filter(Boolean);
    const pathLevels = ctx.config?.pathLevels ?? 1;
    const projectPath = segments.length > 0 ? segments.slice(-pathLevels).join('/') : '/';

    // Dynamically truncate path to fit terminal width
    const termWidth = process.stdout?.columns
      || process.stderr?.columns
      || (Number.parseInt(process.env.COLUMNS ?? '', 10) || 0)
      || 80;
    const configMaxPath = (ctx.config as any)?.maxPathWidth;
    const maxPathWidth = typeof configMaxPath === 'number'
      ? configMaxPath
      : Math.max(10, termWidth - 45);

    const getDisplayWidth = (s: string) =>
      [...s].reduce((w, c) => w + ((c.codePointAt(0) ?? 0) > 0x2E7F ? 2 : 1), 0);

    let displayPath = projectPath;
    if (getDisplayWidth(projectPath) > maxPathWidth) {
      let width = 0;
      let cutIdx = 0;
      for (const c of projectPath) {
        const cw = (c.codePointAt(0) ?? 0) > 0x2E7F ? 2 : 1;
        if (width + cw > maxPathWidth - 1) break;
        width += cw;
        cutIdx += c.length;
      }
      displayPath = projectPath.slice(0, cutIdx) + '…';
    }
    projectPart = yellow(displayPath);
  }

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

    gitPart = `${magenta('git:(')}${cyan(gitParts.join(''))}${magenta(')')}`;
  }

  if (projectPart && gitPart) {
    parts.push(`${projectPart} ${gitPart}`);
  } else if (projectPart) {
    parts.push(projectPart);
  } else if (gitPart) {
    parts.push(gitPart);
  }

  if (display?.showSessionName && ctx.transcript.sessionName) {
    parts.push(dim(ctx.transcript.sessionName));
  }

  if (parts.length === 0) {
    return null;
  }

  return parts.join(' \u2502 ');
}
