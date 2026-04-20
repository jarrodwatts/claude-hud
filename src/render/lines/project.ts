import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RenderContext } from '../../types.js';
import { getModelName, formatModelName, getProviderLabel } from '../../stdin.js';
import { getOutputSpeed } from '../../speed-tracker.js';
import { git as gitColor, gitBranch as gitBranchColor, warning as warningColor, critical as criticalColor, label, model as modelColor, project as projectColor, red, green, yellow, dim, custom as customColor } from '../colors.js';
import { t } from '../../i18n/index.js';
import { renderCostEstimate } from './cost.js';

function hyperlink(uri: string, text: string): string {
  const esc = '\x1b';
  const st = '\\';
  return `${esc}]8;;${uri}${esc}${st}${text}${esc}]8;;${esc}${st}`;
}

export function renderProjectLine(ctx: RenderContext): string | null {
  const display = ctx.config?.display;
  const colors = ctx.config?.colors;
  const parts: string[] = [];

  if (display?.showModel !== false) {
    const model = formatModelName(getModelName(ctx.stdin), ctx.config?.display?.modelFormat, ctx.config?.display?.modelOverride);
    const providerLabel = getProviderLabel(ctx.stdin);
    const modelQualifier = providerLabel ?? undefined;
    let modelDisplay = modelQualifier ? `${model} | ${modelQualifier}` : model;
    if (ctx.effortLevel && ctx.effortSymbol) {
      modelDisplay += ` ${ctx.effortSymbol}${ctx.effortLevel}`;
    } else if (ctx.effortLevel) {
      modelDisplay += ` ${ctx.effortLevel}`;
    }
    parts.push(modelColor(`[${modelDisplay}]`, colors));
  }

  let projectPart: string | null = null;
  if (display?.showProject !== false && ctx.stdin.cwd) {
    const segments = ctx.stdin.cwd.split(/[/\\]/).filter(Boolean);
    const pathLevels = ctx.config?.pathLevels ?? 1;
    const projectPath = segments.length > 0 ? segments.slice(-pathLevels).join('/') : '/';
    const coloredProject = projectColor(projectPath, colors);
    projectPart = hyperlink(`file://${ctx.stdin.cwd}`, coloredProject);
  }

  let gitPart = '';
  const gitConfig = ctx.config?.gitStatus;
  const showGit = gitConfig?.enabled ?? true;

  if (showGit && ctx.gitStatus) {
    const branchText = ctx.gitStatus.branch + ((gitConfig?.showDirty ?? true) && ctx.gitStatus.isDirty ? '*' : '');
    const coloredBranch = gitBranchColor(branchText, colors);
    const linkedBranch = ctx.gitStatus.branchUrl ? hyperlink(ctx.gitStatus.branchUrl, coloredBranch) : coloredBranch;
    const gitInner: string[] = [linkedBranch];

    if (gitConfig?.showAheadBehind) {
      if (ctx.gitStatus.ahead > 0) {
        gitInner.push(formatAheadCount(ctx.gitStatus.ahead, gitConfig, colors));
      }
      if (ctx.gitStatus.behind > 0) gitInner.push(gitBranchColor(`↓${ctx.gitStatus.behind}`, colors));
    }

    if (gitConfig?.showFileStats && ctx.gitStatus.lineDiff) {
      const { added, deleted } = ctx.gitStatus.lineDiff;
      const diffParts: string[] = [];
      if (added > 0) diffParts.push(green(`+${added}`));
      if (deleted > 0) diffParts.push(red(`-${deleted}`));
      if (diffParts.length > 0) {
        gitInner.push(`[${diffParts.join(' ')}]`);
      }
    }

    gitPart = `${gitColor('git:(', colors)}${gitInner.join(' ')}${gitColor(')', colors)}`;
  }

  if (projectPart && gitPart) {
    parts.push(`${projectPart} ${gitPart}`);
  } else if (projectPart) {
    parts.push(projectPart);
  } else if (gitPart) {
    parts.push(gitPart);
  }

  if (display?.showSessionName && ctx.transcript.sessionName) {
    parts.push(label(ctx.transcript.sessionName, colors));
  }

  if (display?.showClaudeCodeVersion && ctx.claudeCodeVersion) {
    parts.push(label(`CC v${ctx.claudeCodeVersion}`, colors));
  }

  if (ctx.extraLabel) {
    parts.push(label(ctx.extraLabel, colors));
  }

  if (display?.showDuration !== false && ctx.sessionDuration) {
    parts.push(label(`⏱️  ${ctx.sessionDuration}`, colors));
  }

  const costEstimate = renderCostEstimate(ctx);
  if (costEstimate) {
    parts.push(costEstimate);
  }

  if (display?.showSpeed) {
    const speed = getOutputSpeed(ctx.stdin);
    if (speed !== null) {
      parts.push(label(`${t('format.out')}: ${speed.toFixed(1)} ${t('format.tokPerSec')}`, colors));
    }
  }

  const customLine = display?.customLine;
  if (customLine) {
    parts.push(customColor(customLine, colors));
  }

  if (parts.length === 0) {
    return null;
  }

  return parts.join(' \u2502 ');
}

function formatAheadCount(
  ahead: number,
  gitConfig: RenderContext['config']['gitStatus'] | undefined,
  colors: RenderContext['config']['colors'] | undefined,
): string {
  const value = `↑${ahead}`;
  const criticalThreshold = gitConfig?.pushCriticalThreshold ?? 0;
  const warningThreshold = gitConfig?.pushWarningThreshold ?? 0;

  if (criticalThreshold > 0 && ahead >= criticalThreshold) {
    return criticalColor(value, colors);
  }

  if (warningThreshold > 0 && ahead >= warningThreshold) {
    return warningColor(value, colors);
  }

  return gitBranchColor(value, colors);
}

export function renderGitFilesLine(ctx: RenderContext, terminalWidth: number | null = null): string | null {
  const gitConfig = ctx.config?.gitStatus;
  if (!(gitConfig?.showFileStats ?? false)) return null;
  if (!ctx.gitStatus?.fileStats) return null;

  const { trackedFiles, untracked } = ctx.gitStatus.fileStats;
  if (trackedFiles.length === 0 && untracked === 0) return null;
  if (terminalWidth !== null && terminalWidth < 60) return null;

  const cwd = ctx.stdin.cwd;
  const sorted = [...trackedFiles].sort((a, b) => {
    try {
      const aMtime = cwd ? fs.statSync(path.join(cwd, a.fullPath)).mtimeMs : 0;
      const bMtime = cwd ? fs.statSync(path.join(cwd, b.fullPath)).mtimeMs : 0;
      return bMtime - aMtime;
    } catch {
      return 0;
    }
  });

  const shown = sorted.slice(0, 6);
  const overflow = sorted.length - shown.length;
  const statParts: string[] = [];

  for (const trackedFile of shown) {
    const prefix = trackedFile.type === 'added' ? green('+') : trackedFile.type === 'deleted' ? red('-') : yellow('~');
    const coloredName = trackedFile.type === 'added'
      ? green(trackedFile.basename)
      : trackedFile.type === 'deleted'
        ? red(trackedFile.basename)
        : yellow(trackedFile.basename);
    const linkedName = cwd ? hyperlink(`file://${path.join(cwd, trackedFile.fullPath)}`, coloredName) : coloredName;
    let entry = `${prefix}${linkedName}`;

    if (trackedFile.lineDiff) {
      const diffParts: string[] = [];
      if (trackedFile.lineDiff.added > 0) diffParts.push(green(`+${trackedFile.lineDiff.added}`));
      if (trackedFile.lineDiff.deleted > 0) diffParts.push(red(`-${trackedFile.lineDiff.deleted}`));
      if (diffParts.length > 0) {
        entry += dim(`(${diffParts.join(' ')})`);
      }
    }

    statParts.push(entry);
  }

  if (overflow > 0) statParts.push(dim(`+${overflow} more`));
  if (untracked > 0) statParts.push(dim(`?${untracked}`));

  return statParts.join('  ');
}
