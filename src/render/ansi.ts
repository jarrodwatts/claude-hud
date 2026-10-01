import { isCjkLanguage } from '../i18n/index.js';
import { dim, RESET } from './colors.js';

// CSI sequences, and OSC sequences ended by BEL or ESC \.
const ESCAPE_AT = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\))/y;
const OSC8 = /\x1b\]8;;([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
const OSC8_CLOSE = '\x1b]8;;\x1b\\';
const SEPARATOR = / \| | │ /g;
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

interface Token {
  text: string;
  escape: boolean;
}

function tokenize(str: string): Token[] {
  const tokens: Token[] = [];
  let start = 0;
  let index = str.indexOf('\x1b');
  while (index !== -1) {
    ESCAPE_AT.lastIndex = index;
    const match = ESCAPE_AT.exec(str);
    if (!match) {
      index = str.indexOf('\x1b', index + 1);
      continue;
    }
    if (index > start) tokens.push({ text: str.slice(start, index), escape: false });
    tokens.push({ text: match[0], escape: true });
    start = index + match[0].length;
    index = str.indexOf('\x1b', start);
  }
  if (start < str.length) tokens.push({ text: str.slice(start), escape: false });
  return tokens;
}

function isWide(codePoint: number): boolean {
  return codePoint >= 0x1100 && (
    codePoint <= 0x115F
    || codePoint === 0x2329
    || codePoint === 0x232A
    || (codePoint >= 0x2E80 && codePoint <= 0xA4CF && codePoint !== 0x303F)
    || (codePoint >= 0xAC00 && codePoint <= 0xD7A3)
    || (codePoint >= 0xF900 && codePoint <= 0xFAFF)
    || (codePoint >= 0xFE10 && codePoint <= 0xFE19)
    || (codePoint >= 0xFE30 && codePoint <= 0xFE6F)
    || (codePoint >= 0xFF00 && codePoint <= 0xFF60)
    || (codePoint >= 0xFFE0 && codePoint <= 0xFFE6)
    || (codePoint >= 0x1F300 && codePoint <= 0x1FAFF)
    || (codePoint >= 0x20000 && codePoint <= 0x3FFFD)
  );
}

// East Asian Ambiguous ranges the HUD emits (box drawing, blocks, arrows, shapes,
// dingbats, ⏱). CJK terminals draw them two cells wide (UAX #11).
function isAmbiguous(codePoint: number): boolean {
  return (codePoint >= 0x2010 && codePoint <= 0x2027)
    || (codePoint >= 0x2030 && codePoint <= 0x205E)
    || (codePoint >= 0x2190 && codePoint <= 0x23FF)
    || (codePoint >= 0x2460 && codePoint <= 0x24FF)
    || (codePoint >= 0x2500 && codePoint <= 0x27BF);
}

function graphemeWidth(grapheme: string, ambiguousWide: boolean): number {
  if (/^\p{Control}$/u.test(grapheme)) return 0;
  if (/\p{Extended_Pictographic}/u.test(grapheme)) return 2;

  let width = 0;
  for (const char of grapheme) {
    const codePoint = char.codePointAt(0) ?? 0;
    const isModifier = /^\p{Mark}$/u.test(char)
      || char === '‍'
      || (codePoint >= 0xFE00 && codePoint <= 0xFE0F)
      || (codePoint >= 0xE0100 && codePoint <= 0xE01EF);
    if (isModifier) continue;
    width = Math.max(width, isWide(codePoint) || (ambiguousWide && isAmbiguous(codePoint)) ? 2 : 1);
  }
  return width;
}

/** Terminal cells taken by plain text (no escape sequences). */
export function textWidth(text: string): number {
  const ambiguousWide = isCjkLanguage();
  let width = 0;
  for (const { segment } of GRAPHEMES.segment(text)) width += graphemeWidth(segment, ambiguousWide);
  return width;
}

export function visibleWidth(str: string): number {
  let width = 0;
  for (const token of tokenize(str)) {
    if (!token.escape) width += textWidth(token.text);
  }
  return width;
}

function stripAnsi(str: string): string {
  return tokenize(str).filter((token) => !token.escape).map((token) => token.text).join('');
}

// The longest prefix that fits in `width` cells, keeping the escapes before the cut.
function sliceToWidth(str: string, width: number): string {
  if (width <= 0) return '';
  const ambiguousWide = isCjkLanguage();
  let result = '';
  let used = 0;
  for (const token of tokenize(str)) {
    if (token.escape) {
      result += token.text;
      continue;
    }
    for (const { segment } of GRAPHEMES.segment(token.text)) {
      used += graphemeWidth(segment, ambiguousWide);
      if (used > width) return result;
      result += segment;
    }
  }
  return result;
}

// Cutting inside an OSC 8 link without closing it would underline the rest of the line.
function closeOpenHyperlink(str: string): string {
  let lastUrl: string | null = null;
  for (const match of str.matchAll(OSC8)) lastUrl = match[1];
  return lastUrl ? OSC8_CLOSE : '';
}

function truncateToWidth(str: string, width: number): string {
  if (width <= 0 || visibleWidth(str) <= width) return str;
  const suffix = width >= 3 ? '...' : '.'.repeat(width);
  const kept = sliceToWidth(str, width - suffix.length);
  return `${kept}${closeOpenHyperlink(kept)}${suffix}${RESET}`;
}

interface WrapPart {
  separator: string;
  text: string;
}

function splitAtSeparators(line: string): WrapPart[] {
  const parts: WrapPart[] = [];
  let separator = '';
  let partStart = 0;
  let offset = 0;
  for (const token of tokenize(line)) {
    if (!token.escape) {
      for (const match of token.text.matchAll(SEPARATOR)) {
        const at = offset + (match.index ?? 0);
        parts.push({ separator, text: line.slice(partStart, at) });
        separator = match[0];
        partStart = at + match[0].length;
      }
    }
    offset += token.text.length;
  }
  parts.push({ separator, text: line.slice(partStart) });

  // A leading "[model | provider]" badge contains a separator but must not wrap.
  const first = stripAnsi(parts[0].text);
  if (first.trimStart().startsWith('[') && !first.includes(']')) {
    let end = 1;
    while (end < parts.length && !stripAnsi(parts[end - 1].text).includes(']')) end += 1;
    const badge = parts.slice(0, end).map((part) => part.separator + part.text).join('');
    return [{ separator: '', text: badge }, ...parts.slice(end)];
  }
  return parts;
}

/** Wraps at the HUD's separators, truncating any part that still overflows. */
export function wrapToWidth(line: string, width: number): string[] {
  if (width <= 0 || visibleWidth(line) <= width) return [line];
  const parts = splitAtSeparators(line);
  if (parts.length <= 1) return [truncateToWidth(line, width)];

  const lines: string[] = [];
  let current = parts[0].text;
  for (const part of parts.slice(1)) {
    const candidate = `${current}${part.separator}${part.text}`;
    if (visibleWidth(candidate) <= width) {
      current = candidate;
      continue;
    }
    lines.push(truncateToWidth(current, width));
    current = part.text;
  }
  if (current) lines.push(truncateToWidth(current, width));
  return lines;
}

/** A dim rule `width` cells wide; ─ is ambiguous-width, so CJK terminals need half as many. */
export function separatorLine(width: number): string {
  const cellsPerDash = isCjkLanguage() ? 2 : 1;
  return dim('─'.repeat(Math.max(1, Math.floor(width / cellsPerDash))));
}
