import type { RenderContext } from "../../types.js";
import { label } from "../colors.js";
import { t } from "../../i18n/index.js";

export function renderEnvironmentLine(ctx: RenderContext): string | null {
  const display = ctx.config?.display;
  const totalCounts =
    ctx.claudeMdCount + ctx.rulesCount + ctx.mcpCount + ctx.hooksCount;
  const threshold = display?.environmentThreshold ?? 0;
  const showCounts = display?.showConfigCounts !== false;
  const showOutputStyle = display?.showOutputStyle === true;
  const parts: string[] = [];

  if (showCounts && totalCounts >= threshold && totalCounts > 0) {
    if (ctx.claudeMdCount > 0) {
      parts.push(`${ctx.claudeMdCount} CLAUDE.md`);
    }

    if (ctx.rulesCount > 0) {
      parts.push(`${ctx.rulesCount} ${t("label.rules")}`);
    }

    if (ctx.mcpCount > 0) {
      parts.push(`${ctx.mcpCount} MCPs`);
    }

    if (ctx.hooksCount > 0) {
      parts.push(`${ctx.hooksCount} ${t("label.hooks")}`);
    }
  }

  if (showOutputStyle && ctx.outputStyle) {
    parts.push(`style: ${ctx.outputStyle}`);
  }

  if (parts.length === 0) {
    return null;
  }

  return label(parts.join(" | "), ctx.config?.colors);
}
