import { isCjkLanguage } from '../i18n/index.js';

// CJK terminals render East Asian Ambiguous-width chars (box drawing,
// block elements, arrows, etc.) as 2 cells. The HUD bar/separator/icon
// glyphs fall in those ranges, so width math must follow suit when the
// user's language is CJK — otherwise wrap calculations under-report
// visual width and the terminal itself wraps.
// https://www.unicode.org/reports/tr11/
export function isCjkAmbiguousWide(): boolean {
  return isCjkLanguage();
}

export function isWideCodePoint(codePoint: number): boolean {
  return codePoint >= 0x1100 && (
    codePoint <= 0x115F || // Hangul Jamo
    codePoint === 0x2329 ||
    codePoint === 0x232A ||
    (codePoint >= 0x2E80 && codePoint <= 0xA4CF && codePoint !== 0x303F) ||
    (codePoint >= 0xAC00 && codePoint <= 0xD7A3) ||
    (codePoint >= 0xF900 && codePoint <= 0xFAFF) ||
    (codePoint >= 0xFE10 && codePoint <= 0xFE19) ||
    (codePoint >= 0xFE30 && codePoint <= 0xFE6F) ||
    (codePoint >= 0xFF00 && codePoint <= 0xFF60) ||
    (codePoint >= 0xFFE0 && codePoint <= 0xFFE6) ||
    (codePoint >= 0x1F300 && codePoint <= 0x1FAFF) ||
    (codePoint >= 0x20000 && codePoint <= 0x3FFFD)
  );
}

// East Asian Ambiguous-width ranges actually emitted by the HUD:
// box drawing (│ ─), block elements (█ ░), geometric shapes (◐ ● ▸),
// arrows (↑ ↓ →), math operators (≤ ≥), misc symbols (⚠), dingbats
// (✓ ✘), general punctuation (— …), misc technical (⏱).
export function isAmbiguousWideCodePoint(codePoint: number): boolean {
  if (codePoint < 0x2010) return false;
  return (
    (codePoint >= 0x2010 && codePoint <= 0x2027) ||
    (codePoint >= 0x2030 && codePoint <= 0x205E) ||
    (codePoint >= 0x2190 && codePoint <= 0x21FF) ||
    (codePoint >= 0x2200 && codePoint <= 0x22FF) ||
    (codePoint >= 0x2300 && codePoint <= 0x23FF) ||
    (codePoint >= 0x2460 && codePoint <= 0x24FF) ||
    (codePoint >= 0x2500 && codePoint <= 0x259F) ||
    (codePoint >= 0x25A0 && codePoint <= 0x25FF) ||
    (codePoint >= 0x2600 && codePoint <= 0x26FF) ||
    (codePoint >= 0x2700 && codePoint <= 0x27BF)
  );
}

export function codePointCellWidth(codePoint: number, ambiguousWide: boolean): number {
  if (isWideCodePoint(codePoint)) return 2;
  if (ambiguousWide && isAmbiguousWideCodePoint(codePoint)) return 2;
  return 1;
}
