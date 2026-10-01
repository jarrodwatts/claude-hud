import type { HudColorOverrides } from "../../config.js";
import type { MessageKey } from "../../i18n/types.js";
import { label } from "../colors.js";
import { t } from "../../i18n/index.js";
import { textWidth as plainTextWidth } from "../ansi.js";

/** Label keys that should be aligned when rendered on separate lines. */
const PROGRESS_LABEL_KEYS: MessageKey[] = [
  "label.context",
  "label.usage",
  "label.weekly",
  "label.approxRam",
];

export interface ProgressLabelOptions {
  align?: boolean;
  includeMemoryInWidth?: boolean;
}

export type ProgressLabelInput = boolean | ProgressLabelOptions;

/** Compute the max visual width across the progress-bar labels in view. */
function maxLabelWidth(includeMemory = false): number {
  let max = 0;
  for (const key of PROGRESS_LABEL_KEYS) {
    if (key === "label.approxRam" && !includeMemory) {
      continue;
    }
    const w = plainTextWidth(t(key));
    if (w > max) max = w;
  }
  return max;
}

/**
 * Return a label whose visible text is right-padded to align with the widest
 * progress-bar label in the current locale, then wrapped with the `label()`
 * ANSI helper.
 */
export function paddedLabel(
  key: MessageKey,
  colors?: Partial<HudColorOverrides>,
  options: Pick<ProgressLabelOptions, "includeMemoryInWidth"> = {},
): string {
  const text = t(key);
  const pad = maxLabelWidth(options.includeMemoryInWidth) - plainTextWidth(text);
  const padded = pad > 0 ? text + " ".repeat(pad) : text;
  return label(padded, colors);
}

export function progressLabel(
  key: MessageKey,
  colors?: Partial<HudColorOverrides>,
  options: ProgressLabelInput = {},
): string {
  const normalized = typeof options === "boolean" ? { align: options } : options;
  return normalized.align
    ? paddedLabel(key, colors, normalized)
    : label(t(key), colors);
}

