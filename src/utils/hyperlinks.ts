import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { sanitizeDisplayText } from './sanitize.js';

const LINK_PROTOCOLS = new Set(['https:', 'file:']);

export function getFileHref(filePath: string): string | null {
  try {
    return pathToFileURL(path.resolve(filePath)).toString();
  } catch {
    return null;
  }
}

// Windows decodes a file: URL's %XX escapes with the ANSI code page, not UTF-8, so a
// percent-encoded non-ASCII path opens nothing there. Those characters go out raw instead.
const rawNonAscii = (href: string) =>
  href.replace(/(?:%[89A-F][0-9A-F])+/gi, (escapes) => sanitizeDisplayText(decodeURIComponent(escapes)));

/** `text` as an OSC 8 link to `uri` when that is a valid https: or file: URL, else plain `text`. */
export function safeHyperlink(uri: string | undefined | null, text: string): string {
  if (!uri) return text;
  try {
    const url = new URL(sanitizeDisplayText(uri));
    if (!LINK_PROTOCOLS.has(url.protocol)) return text;
    const href = url.protocol === 'file:' && process.platform === 'win32' ? rawNonAscii(url.href) : url.href;
    return `\x1b]8;;${href}\x1b\\${text}\x1b]8;;\x1b\\`;
  } catch {
    return text;
  }
}
