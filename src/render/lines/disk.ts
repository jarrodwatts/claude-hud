import type { RenderContext } from "../../types.js";
import { formatBytes } from "../../memory.js";
import { getQuotaColor, quotaBar, RESET } from "../colors.js";
import { getAdaptiveBarWidth } from "../../utils/terminal.js";
import { t } from "../../i18n/index.js";
import {
  progressLabel,
  type ProgressLabelOptions,
} from "./label-align.js";

export function renderDiskLine(
  ctx: RenderContext,
  labelOptions: ProgressLabelOptions = {},
): string | null {
  const display = ctx.config?.display;
  const colors = ctx.config?.colors;

  if (ctx.config?.lineLayout !== "expanded") {
    return null;
  }

  if (display?.showDiskUsage !== true) {
    return null;
  }

  if (!ctx.diskUsage) {
    return null;
  }

  const diskLabel = progressLabel("label.disk", colors, labelOptions);
  const percentColor = getQuotaColor(ctx.diskUsage.usedPercent, colors);
  const percent = `${percentColor}${ctx.diskUsage.usedPercent}%${RESET}`;
  const bar = quotaBar(
    ctx.diskUsage.usedPercent,
    getAdaptiveBarWidth(),
    colors,
  );

  const free = `${formatBytes(ctx.diskUsage.freeBytes)} ${t("format.free")}`;

  return `${diskLabel} ${bar} ${formatBytes(ctx.diskUsage.usedBytes)} / ${formatBytes(ctx.diskUsage.totalBytes)} (${percent}, ${free})`;
}
