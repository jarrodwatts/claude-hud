const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Cut within the UTF-16 length budget without splitting graphemes; append `suffix` when cut. */
export function truncateString(text: string | null | undefined, maxLen: number, suffix = '...'): string {
  if (!text) return '';
  if (text.length <= maxLen) return text;
  const limit = Math.max(0, maxLen - suffix.length);
  let end = 0;
  for (const { segment, index } of GRAPHEMES.segment(text)) {
    if (index + segment.length > limit) break;
    end = index + segment.length;
  }
  return text.slice(0, end) + suffix;
}
