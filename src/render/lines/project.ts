import type { RenderContext, StatusData } from "../../types.js";
import { getModelName, getProviderLabel } from "../../stdin.js";
import { getOutputSpeed } from "../../speed-tracker.js";
import {
  green,
  yellow,
  git as gitColor,
  gitBranch as gitBranchColor,
  label,
  model as modelColor,
  project as projectColor,
  red,
  custom as customColor,
} from "../colors.js";

export function renderProjectLine(ctx: RenderContext): string | null {
  const display = ctx.config?.display;
  const colors = ctx.config?.colors;
  const parts: string[] = [];

  if (display?.showModel !== false) {
    const model = getModelName(ctx.stdin);
    const providerLabel = getProviderLabel(ctx.stdin);
    const showUsage = display?.showUsage !== false;
    const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
    const modelQualifier =
      providerLabel ?? (showUsage && hasApiKey ? red("API") : undefined);
    const modelDisplay = modelQualifier
      ? `${model} | ${modelQualifier}`
      : model;
    parts.push(modelColor(`[${modelDisplay}]`, colors));
  }

  let projectPart: string | null = null;
  if (display?.showProject !== false && ctx.stdin.cwd) {
    const segments = ctx.stdin.cwd.split(/[/\\]/).filter(Boolean);
    const pathLevels = ctx.config?.pathLevels ?? 1;
    const projectPath =
      segments.length > 0 ? segments.slice(-pathLevels).join("/") : "/";
    projectPart = projectColor(projectPath, colors);
  }

  let gitPart = "";
  const gitConfig = ctx.config?.gitStatus;
  const showGit = gitConfig?.enabled ?? true;

  if (showGit && ctx.gitStatus) {
    const gitParts: string[] = [ctx.gitStatus.branch];

    if ((gitConfig?.showDirty ?? true) && ctx.gitStatus.isDirty) {
      gitParts.push("*");
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
        gitParts.push(` ${statParts.join(" ")}`);
      }
    }

    gitPart = `${gitColor("git:(", colors)}${gitBranchColor(gitParts.join(""), colors)}${gitColor(")", colors)}`;
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

  if (display?.showStatus && ctx.statusData) {
    parts.push(formatStatusSegment(ctx.statusData));
  }

  const customLine = display?.customLine;
  if (customLine) {
    parts.push(customColor(customLine, colors));
  }

  if (parts.length === 0) {
    return null;
  }

  return parts.join(" \u2502 ");
}

function formatStatusSegment(data: StatusData): string {
  const { status, activeIncident } = data;

  switch (status) {
    case "degraded_performance":
      return yellow(activeIncident ? `◐ ${activeIncident}` : "◐ Degraded");
    case "partial_outage":
      return red(activeIncident ? `◑ ${activeIncident}` : "◑ Partial Outage");
    case "major_outage":
      return red(activeIncident ? `✖ ${activeIncident}` : "✖ Major Outage");
    case "under_maintenance":
      return yellow("⏳ Maintenance");
    default:
      return green("●");
  }
}
