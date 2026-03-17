import type { RenderContext } from '../../types.js';
import { getModelName, getProviderLabel } from '../../stdin.js';
import { getOutputSpeed } from '../../speed-tracker.js';
import { cyan, dim, magenta, yellow, red, claudeOrange } from '../colors.js';

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
    projectPart = yellow(projectPath);
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

  if (ctx.extraLabel) {
    parts.push(dim(ctx.extraLabel));
  }

  if (display?.showSpeed) {
    const speed = getOutputSpeed(ctx.stdin);
    if (speed !== null) {
      parts.push(dim(`out: ${speed.toFixed(1)} tok/s`));
    }
  }

  if (display?.showDuration !== false && ctx.sessionDuration) {
    parts.push(dim(`⏱️  ${ctx.sessionDuration}`));
  }

  const customLine = display?.customLine;
  if (customLine) {
    parts.push(claudeOrange(customLine));
  }

  if (parts.length === 0) {
    return null;
  }

  return parts.join(' \u2502 ');
}
