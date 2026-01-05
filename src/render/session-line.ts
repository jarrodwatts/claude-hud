import path from 'node:path';
import type { RenderContext } from '../types.js';
import { getContextPercent, getModelName } from '../stdin.js';
import { coloredBar, cyan, dim, magenta, red, yellow, getContextColor, RESET } from './colors.js';

export function renderSessionLine(ctx: RenderContext): string {
  const model = getModelName(ctx.stdin);
  const percent = getContextPercent(ctx.stdin);
  const bar = coloredBar(percent);

  const parts: string[] = [];

  // Show project path first (configurable path levels, default 1)
  if (ctx.stdin.cwd) {
    // Split by both Unix (/) and Windows (\) separators for cross-platform support
    const segments = ctx.stdin.cwd.split(/[/\\]/).filter(Boolean);
    const pathLevels = ctx.config?.pathLevels ?? 1;
    // Always join with forward slash for consistent display
    const projectPath = segments.slice(-pathLevels).join('/');
    const showGit = ctx.config?.gitStatus?.enabled ?? true;
    const branchPart = showGit && ctx.gitBranch ? ` ${magenta('git:(')}${cyan(ctx.gitBranch)}${magenta(')')}` : '';
    parts.push(`${yellow(projectPath)}${branchPart}`);
  }

  parts.push(`${cyan(`[${model}]`)} ${bar} ${getContextColor(percent)}${percent}%${RESET}`);

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

  if (ctx.sessionDuration) {
    parts.push(dim(`⏱️  ${ctx.sessionDuration}`));
  }

  let line = parts.join(' | ');

  if (percent >= 85) {
    const usage = ctx.stdin.context_window?.current_usage;
    if (usage) {
      const input = formatTokens(usage.input_tokens ?? 0);
      const cache = formatTokens((usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0));
      line += dim(` (in: ${input}, cache: ${cache})`);
    }
  }

  return line;
}

function formatTokens(n: number): string {
  if (n >= 1000000) {
    return `${(n / 1000000).toFixed(1)}M`;
  }
  if (n >= 1000) {
    return `${(n / 1000).toFixed(0)}k`;
  }
  return n.toString();
}
