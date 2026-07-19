import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RenderContext } from '../../types.js';
import { getModelName, formatModelName, resolveModelName } from '../../stdin.js';
import { getOutputSpeed } from '../../speed-tracker.js';
import { git as gitColor, gitBranch as gitBranchColor, warning as warningColor, critical as criticalColor, label, model as modelColor, project as projectColor, red, green, yellow, dim, custom as customColor } from '../colors.js';
import { t } from '../../i18n/index.js';
import { renderCostEstimate } from './cost.js';
import { renderAdvisorLine } from './advisor.js';
import { normalizeAddedDirs, sanitize as sanitizeDisplayText, basenameOf, truncateBasename, MAX_RENDERED_ADDED_DIRS } from './added-dirs.js';
import { hyperlink, getFileHref, safeHyperlink } from '../../utils/hyperlinks.js';
import { formatModelDisplay } from '../model-display.js';
import { formatAuthSegment } from '../../auth.js';
import { formatProjectPath } from '../project-path.js';
import { DEFAULT_PROJECT_LINE_ORDER } from '../../config.js';
import type { FirstLineSegment } from '../../config.js';
import { orderFirstLineParts } from '../first-line-order.js';
import type { FirstLinePart } from '../first-line-order.js';

function resolvePathWithinCwd(cwd: string, candidatePath: string): string | null {
  const resolvedCwd = path.resolve(cwd);
  const resolvedPath = path.resolve(cwd, candidatePath);
  const relative = path.relative(resolvedCwd, resolvedPath);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    return resolvedPath;
  }
  return null;
}

export function renderProjectLine(ctx: RenderContext): string | null {
  const display = ctx.config?.display;
  const colors = ctx.config?.colors;
  const parts: FirstLinePart[] = [];
  const push = (text: string, key: FirstLineSegment | null = null) => parts.push({ key, text });

  const customLine = display?.customLine;
  const customLinePosition = display?.customLinePosition ?? 'last';
  if (customLine && customLinePosition === 'first') {
    push(customColor(customLine, colors));
  }

  if (display?.showModel !== false) {
    const model = formatModelName(resolveModelName(ctx.stdin, ctx.transcript, ctx.config?.display?.modelSource), ctx.config?.display?.modelFormat, ctx.config?.display?.modelOverride);
    const modelDisplay = formatModelDisplay(model, ctx);
    push(modelColor(`[${modelDisplay}]`, colors), 'model');
  }

  let projectPart: string | null = null;
  if (display?.showProject !== false && ctx.stdin.cwd) {
    const pathLevels = ctx.config?.pathLevels ?? 1;
    const projectPath = formatProjectPath(ctx.stdin.cwd, pathLevels);
    const coloredProject = projectColor(projectPath, colors);
    projectPart = safeHyperlink(getFileHref(ctx.stdin.cwd), coloredProject);
  }

  let addedDirsPart: string | null = null;
  const addedDirs = normalizeAddedDirs(ctx.stdin.workspace?.added_dirs);
  const addedDirsLayout = display?.addedDirsLayout ?? 'inline';
  if (display?.showAddedDirs !== false && addedDirsLayout === 'inline' && addedDirs.length > 0) {
    const visible = addedDirs.slice(0, MAX_RENDERED_ADDED_DIRS);
    const overflow = addedDirs.length - visible.length;
    const rendered = visible.map((dir) => {
      const name = truncateBasename(sanitizeDisplayText(basenameOf(dir)));
      const text = dim(`+${name}`);
      return safeHyperlink(getFileHref(dir), text);
    });
    if (overflow > 0) {
      rendered.push(dim(`+${overflow} more`));
    }
    addedDirsPart = rendered.join(' ');
  }

  let gitPart = '';
  const gitConfig = ctx.config?.gitStatus;
  const showGit = gitConfig?.enabled ?? true;
  const branchOverflow = gitConfig?.branchOverflow ?? 'truncate';

  if (showGit && ctx.gitStatus) {
    const branchText = sanitizeDisplayText(
      ctx.gitStatus.branch + ((gitConfig?.showDirty ?? true) && ctx.gitStatus.isDirty ? '*' : '')
    );
    const coloredBranch = gitBranchColor(branchText, colors);
    const linkedBranch = safeHyperlink(ctx.gitStatus.branchUrl, coloredBranch);
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

  const projectWithDirs = projectPart && addedDirsPart
    ? `${projectPart} ${addedDirsPart}`
    : projectPart ?? addedDirsPart;

  if (projectWithDirs && gitPart) {
    if (branchOverflow === 'wrap') {
      push(projectWithDirs, 'project');
      push(gitPart, 'project');
    } else {
      push(`${projectWithDirs} ${gitPart}`, 'project');
    }
  } else if (projectWithDirs) {
    push(projectWithDirs, 'project');
  } else if (gitPart) {
    push(gitPart, 'project');
  }

  // Advisor model sits inline with the model/project/git badge so the
  // configured /advisor is visible on the first line at a glance.
  if (display?.showAdvisor) {
    const advisorPart = renderAdvisorLine(ctx);
    if (advisorPart) {
      push(advisorPart, 'advisor');
    }
  }

  if (display?.showSessionName && ctx.transcript.sessionName) {
    push(label(ctx.transcript.sessionName, colors), 'sessionName');
  }

  if (display?.showClaudeCodeVersion && ctx.claudeCodeVersion) {
    push(label(`CC v${ctx.claudeCodeVersion}`, colors), 'version');
  }

  if (ctx.extraLabel) {
    push(label(ctx.extraLabel, colors), 'extra');
  }

  if (display?.showDuration === true && ctx.sessionDuration) {
    push(label(`⏱️  ${ctx.sessionDuration}`, colors), 'duration');
  }

  const costEstimate = renderCostEstimate(ctx);
  if (costEstimate) {
    push(costEstimate, 'cost');
  }

  if (display?.showSpeed) {
    const speed = getOutputSpeed(ctx.stdin);
    if (speed !== null) {
      push(label(`${t('format.out')}: ${speed.toFixed(1)} ${t('format.tokPerSec')}`, colors), 'speed');
    }
  }

  const authSegment = formatAuthSegment(ctx.authInfo, display);
  if (authSegment) {
    push(label(authSegment, colors), 'auth');
  }

  if (customLine && customLinePosition === 'last') {
    push(customColor(customLine, colors));
  }

  if (parts.length === 0) {
    return null;
  }

  const order = ctx.config?.projectLineOrder ?? DEFAULT_PROJECT_LINE_ORDER;
  return orderFirstLineParts(parts, order).join(' \u2502 ');
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
      const aPath = cwd ? resolvePathWithinCwd(cwd, a.fullPath) : null;
      const bPath = cwd ? resolvePathWithinCwd(cwd, b.fullPath) : null;
      const aMtime = aPath ? fs.statSync(aPath).mtimeMs : 0;
      const bMtime = bPath ? fs.statSync(bPath).mtimeMs : 0;
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
    const safeBasename = sanitizeDisplayText(trackedFile.basename);
    const coloredName = trackedFile.type === 'added'
      ? green(safeBasename)
      : trackedFile.type === 'deleted'
        ? red(safeBasename)
        : yellow(safeBasename);
    const resolvedPath = cwd ? resolvePathWithinCwd(cwd, trackedFile.fullPath) : null;
    const linkedName = resolvedPath ? safeHyperlink(getFileHref(resolvedPath), coloredName) : coloredName;
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
