/** `text` cut to `maxLen` characters, ending in `suffix` when cut. */
export function truncateString(text: string | null | undefined, maxLen: number, suffix = '...'): string {
  if (!text) return '';
  return text.length <= maxLen ? text : text.slice(0, Math.max(0, maxLen - suffix.length)) + suffix;
}
