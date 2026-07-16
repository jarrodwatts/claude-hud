import type { RenderContext } from "../../types.js";
import { formatBytes } from "../../memory.js";
import { getQuotaColor, quotaBar, RESET } from "../colors.js";
import { getAdaptiveBarWidth } from "../../utils/terminal.js";
import {
  progressLabel,
  type ProgressLabelOptions,
} from "./label-align.js";

export function renderMemoryLine(
  ctx: RenderContext,
  labelOptions: ProgressLabelOptions = {},
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

  const memoryLabel = progressLabel(
    "label.approxRam",
    colors,
    { ...labelOptions, includeMemoryInWidth: true },
  );
  const percentColor = getQuotaColor(ctx.memoryUsage.usedPercent, colors);
  const percent = `${percentColor}${ctx.memoryUsage.usedPercent}%${RESET}`;
  const bar = quotaBar(
    ctx.memoryUsage.usedPercent,
    getAdaptiveBarWidth(),
    colors,
  );

  return `${memoryLabel} ${bar} ${formatBytes(ctx.memoryUsage.usedBytes)} / ${formatBytes(ctx.memoryUsage.totalBytes)} (${percent})`;
}
