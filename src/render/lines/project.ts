import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RenderContext } from '../../types.js';
import { getModelName, getProviderLabel } from '../../stdin.js';
import { getOutputSpeed } from '../../speed-tracker.js';
import { git as gitColor, gitBranch as gitBranchColor, label, model as modelColor, project as projectColor, red, green, yellow, dim, custom as customColor } from '../colors.js';

/** Wrap text in an OSC 8 terminal hyperlink (works in iTerm2, WezTerm, Kitty, Ghostty, etc.) */
function hyperlink(uri: string, text: string): string {
  const ESC = '\x1b';
  const ST = '\\';
  return `${ESC}]8;;${uri}${ESC}${ST}${text}${ESC}]8;;${ESC}${ST}`;
}

export function renderProjectLine(ctx: RenderContext): string | null {
  const display = ctx.config?.display;
  const colors = ctx.config?.colors;
  const parts: string[] = [];

  if (display?.showModel !== false) {
    const model = getModelName(ctx.stdin);
    const providerLabel = getProviderLabel(ctx.stdin);
    const showUsage = display?.showUsage !== false;
    const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
    const modelQualifier = providerLabel ?? (showUsage && hasApiKey ? red('API') : undefined);
    const modelDisplay = modelQualifier ? `${model} | ${modelQualifier}` : model;
    parts.push(modelColor(`[${modelDisplay}]`, colors));
  }

  let projectPart: string | null = null;
  if (display?.showProject !== false && ctx.stdin.cwd) {
    const segments = ctx.stdin.cwd.split(/[/\\]/).filter(Boolean);
    const pathLevels = ctx.config?.pathLevels ?? 1;
    const projectPath = segments.length > 0 ? segments.slice(-pathLevels).join('/') : '/';
    const coloredProject = projectColor(projectPath, colors);
    const linkedProject = hyperlink(`file://${ctx.stdin.cwd}`, coloredProject);
    projectPart = linkedProject;
  }

  let gitPart = '';
  const gitConfig = ctx.config?.gitStatus;
  const showGit = gitConfig?.enabled ?? true;

  if (showGit && ctx.gitStatus) {
    const branchText = ctx.gitStatus.branch + ((gitConfig?.showDirty ?? true) && ctx.gitStatus.isDirty ? '*' : '');
    const coloredBranch = gitBranchColor(branchText, colors);
    const linkedBranch = ctx.gitStatus.branchUrl
      ? hyperlink(ctx.gitStatus.branchUrl, coloredBranch)
      : coloredBranch;

    const gitInner: string[] = [linkedBranch];

    if (gitConfig?.showAheadBehind) {
      if (ctx.gitStatus.ahead > 0) gitInner.push(gitBranchColor(`↑${ctx.gitStatus.ahead}`, colors));
      if (ctx.gitStatus.behind > 0) gitInner.push(gitBranchColor(`↓${ctx.gitStatus.behind}`, colors));
    }

    if (gitConfig?.showFileStats && ctx.gitStatus.lineDiff) {
      const { added: la, deleted: ld } = ctx.gitStatus.lineDiff;
      const lineParts: string[] = [];
      if (la > 0) lineParts.push(green(`+${la}`));
      if (ld > 0) lineParts.push(red(`-${ld}`));
      if (lineParts.length > 0) {
        gitInner.push(`[${lineParts.join(' ')}]`);
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

  if (display?.showSpeed) {
    const speed = getOutputSpeed(ctx.stdin);
    if (speed !== null) {
      parts.push(label(`out: ${speed.toFixed(1)} tok/s`, colors));
    }
  }

  if (display?.showDuration !== false && ctx.sessionDuration) {
    parts.push(label(`⏱️  ${ctx.sessionDuration}`, colors));
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

/**
 * Renders a dedicated line listing individually modified/added/deleted files,
 * sorted by most-recently-modified, with per-file line diffs.
 * Controlled by `gitStatus.showFileStats: true` in config.
 * Pass terminalWidth to hide the line entirely when the terminal is too narrow.
 */
export function renderGitFilesLine(ctx: RenderContext, terminalWidth: number | null = null): string | null {
  const gitConfig = ctx.config?.gitStatus;
  if (!(gitConfig?.showFileStats ?? false)) return null;
  if (!ctx.gitStatus?.fileStats) return null;

  const { trackedFiles, untracked } = ctx.gitStatus.fileStats;
  if (trackedFiles.length === 0 && untracked === 0) return null;

  // Hide on very narrow terminals (threshold: 60 columns)
  if (terminalWidth !== null && terminalWidth < 60) return null;

  const cwd = ctx.stdin.cwd;

  // Sort by mtime descending (most recently modified first)
  const sorted = [...trackedFiles].sort((a, b) => {
    try {
      const aMtime = cwd ? fs.statSync(path.join(cwd, a.fullPath)).mtimeMs : 0;
      const bMtime = cwd ? fs.statSync(path.join(cwd, b.fullPath)).mtimeMs : 0;
      return bMtime - aMtime;
    } catch {
      return 0;
    }
  });

  const MAX_FILES = 6;
  const shown = sorted.slice(0, MAX_FILES);
  const overflow = sorted.length - shown.length;
  const statParts: string[] = [];

  for (const tf of shown) {
    const prefix = tf.type === 'added' ? green('+') : tf.type === 'deleted' ? red('-') : yellow('~');
    const coloredName = tf.type === 'added' ? green(tf.basename) : tf.type === 'deleted' ? red(tf.basename) : yellow(tf.basename);
    const linkedName = cwd
      ? hyperlink(`file://${path.join(cwd, tf.fullPath)}`, coloredName)
      : coloredName;
    let entry = `${prefix}${linkedName}`;
    if (tf.lineDiff) {
      const parts: string[] = [];
      if (tf.lineDiff.added > 0) parts.push(green(`+${tf.lineDiff.added}`));
      if (tf.lineDiff.deleted > 0) parts.push(red(`-${tf.lineDiff.deleted}`));
      if (parts.length > 0) entry += dim(`(${parts.join(' ')})`);
    }
    statParts.push(entry);
  }

  if (overflow > 0) statParts.push(dim(`+${overflow} more`));
  if (untracked > 0) statParts.push(dim(`?${untracked}`));

  return statParts.join('  ');
}
