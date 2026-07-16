import type { HudColorOverrides } from "../../config.js";
import type { MessageKey } from "../../i18n/types.js";
import { label } from "../colors.js";
import { t } from "../../i18n/index.js";
import { codePointCellWidth, isCjkAmbiguousWide } from "../width.js";

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

/**
 * Compute the visual width of a plain-text string (no ANSI).
 * CJK ideographs count as 2 cells; ASCII characters count as 1.
 * In CJK locales, East Asian Ambiguous-width chars also count as 2.
 */
function plainTextWidth(str: string): number {
  const ambiguousWide = isCjkAmbiguousWide();
  let width = 0;
  for (const char of str) {
    const cp = char.codePointAt(0);
    if (cp !== undefined) {
      width += codePointCellWidth(cp, ambiguousWide);
    } else {
      width += 1;
    }
  }
  return width;
}

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

// Exported for testing only.
export { plainTextWidth as _plainTextWidth, maxLabelWidth as _maxLabelWidth };
