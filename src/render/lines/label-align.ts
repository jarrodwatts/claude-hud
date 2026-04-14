import type { HudColorOverrides } from "../../config.js";
import type { MessageKey } from "../../i18n/types.js";
import { label } from "../colors.js";
import { t } from "../../i18n/index.js";

/** Label keys that should be aligned when rendered on separate lines. */
const PROGRESS_LABEL_KEYS: MessageKey[] = [
  "label.context",
  "label.usage",
  "label.weekly",
];

/**
 * Compute the visual width of a plain-text string (no ANSI).
 * CJK ideographs count as 2 cells; ASCII characters count as 1.
 */
function plainTextWidth(str: string): number {
  let width = 0;
  for (const char of str) {
    const cp = char.codePointAt(0);
    if (cp !== undefined && isWideCodePoint(cp)) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

function isWideCodePoint(codePoint: number): boolean {
  return (
    codePoint >= 0x1100 &&
    (codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
      (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
      (codePoint >= 0x20000 && codePoint <= 0x3fffd))
  );
}

/** Compute the max visual width across the three progress-bar labels. */
function maxLabelWidth(): number {
  let max = 0;
  for (const key of PROGRESS_LABEL_KEYS) {
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
): string {
  const text = t(key);
  const pad = maxLabelWidth() - plainTextWidth(text);
  const padded = pad > 0 ? text + " ".repeat(pad) : text;
  return label(padded, colors);
}

// Exported for testing only.
export { plainTextWidth as _plainTextWidth, maxLabelWidth as _maxLabelWidth };
