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

/** `text` as an OSC 8 link to `uri` when that is a valid https: or file: URL, else plain `text`. */
export function safeHyperlink(uri: string | undefined | null, text: string): string {
  if (!uri) return text;
  try {
    const url = new URL(sanitizeDisplayText(uri));
    return LINK_PROTOCOLS.has(url.protocol) ? `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\` : text;
  } catch {
    return text;
  }
}
