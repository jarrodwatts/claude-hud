import type { RenderContext } from "../../types.js";
import { formatBytes } from "../../memory.js";
import { label, getQuotaColor, quotaBar, RESET } from "../colors.js";
import { getAdaptiveBarWidth } from "../../utils/terminal.js";
import { t } from "../../i18n/index.js";

type RenderDensity = 'normal' | 'compact';

export function renderMemoryLine(
  ctx: RenderContext,
  options: { density?: RenderDensity } = {},
): string | null {
  const display = ctx.config?.display;
  const colors = ctx.config?.colors;

  if (ctx.config?.lineLayout !== "expanded") {
    return null;
  }

  if (display?.showMemoryUsage !== true) {
    return null;
  }

  if (!ctx.memoryUsage) {
    return null;
  }

  const memoryLabel = label(t("label.approxRam"), colors);
  const percentColor = getQuotaColor(ctx.memoryUsage.usedPercent, colors);
  const percent = `${percentColor}${ctx.memoryUsage.usedPercent}%${RESET}`;
  const usage = `${formatBytes(ctx.memoryUsage.usedBytes)} / ${formatBytes(ctx.memoryUsage.totalBytes)} (${percent})`;

  if (options.density === 'compact') {
    return `${memoryLabel} ${usage}`;
  }

  const bar = quotaBar(
    ctx.memoryUsage.usedPercent,
    getAdaptiveBarWidth(),
    colors,
  );

  return `${memoryLabel} ${bar} ${usage}`;
}
