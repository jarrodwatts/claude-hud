import type { RenderContext } from "../../types.js";
import { critical, label } from "../colors.js";
import { t } from "../../i18n/index.js";
import { sanitizeDisplayText } from "../../utils/sanitize.js";
import { outputStyle } from '../derive.js';

/** How many failing server names to spell out before collapsing to a count. */
const MAX_NAMED_MCP_ERRORS = 3;

export function renderEnvironmentLine(ctx: RenderContext): string | null {
  const display = ctx.config?.display;
  const totalCounts =
    ctx.claudeMdCount + ctx.rulesCount + ctx.mcpCount + ctx.hooksCount;
  const threshold = display?.environmentThreshold ?? 0;
  const showCounts = display?.showConfigCounts === true;
  const showOutputStyle = display?.showOutputStyle === true;
  const showMcpErrors = showCounts || display?.showMcp === true;
  const mcpErrors = showMcpErrors ? (ctx.transcript?.mcpErrors ?? []) : [];
  const colors = ctx.config?.colors;
  const parts: string[] = [];
  let renderedMcpCount = false;

  if (showCounts && totalCounts >= threshold && totalCounts > 0) {
    if (ctx.claudeMdCount > 0) {
      parts.push(label(`${ctx.claudeMdCount} CLAUDE.md`, colors));
    }

    if (ctx.rulesCount > 0) {
      parts.push(label(`${ctx.rulesCount} ${t("label.rules")}`, colors));
    }

    if (ctx.mcpCount > 0) {
      parts.push(mcpErrors.length > 0
        ? `${label(`${ctx.mcpCount} MCPs`, colors)} ${formatMcpErrors(mcpErrors, colors)}`
        : label(`${ctx.mcpCount} MCPs`, colors));
      renderedMcpCount = true;
    }

    if (ctx.hooksCount > 0) {
      parts.push(label(`${ctx.hooksCount} ${t("label.hooks")}`, colors));
    }
  }

  const style = showOutputStyle ? outputStyle(ctx) : undefined;
  if (style) {
    parts.push(label(`style: ${style}`, colors));
  }

  if (mcpErrors.length > 0 && !renderedMcpCount) {
    parts.push(formatMcpErrors(mcpErrors, colors));
  }

  if (parts.length === 0) {
    return null;
  }

  return parts.join(" | ");
}

/** `⚠ github, tenable +2` — names first, then an overflow count. */
function formatMcpErrors(mcpErrors: string[], colors: RenderContext['config']['colors']): string {
  const safeNames = mcpErrors
    .map(name => sanitizeDisplayText(name).trim().slice(0, 64))
    .filter(Boolean);
  const named = safeNames.slice(0, MAX_NAMED_MCP_ERRORS).join(", ");
  const overflow = safeNames.length - MAX_NAMED_MCP_ERRORS;
  const suffix = overflow > 0 ? ` +${overflow}` : "";
  return critical(`⚠ ${named}${suffix}`, colors);
}
