import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { sanitizeDisplayText } from './sanitize.js';

/**
 * Wrap `text` in an OSC 8 hyperlink pointing to `uri`.
 */
export function hyperlink(uri: string, text: string): string {
  const esc = '\x1b';
  const st = '\\';
  return `${esc}]8;;${uri}${esc}${st}${text}${esc}]8;;${esc}${st}`;
}

/**
 * Convert a filesystem path to a `file://` URL string.
 * Returns `null` on failure.
 */
export function getFileHref(filePath: string): string | null {
  try {
    return pathToFileURL(path.resolve(filePath)).toString();
  } catch {
    return null;
  }
}

/**
 * Build a `<scheme>://file/<path>` URI for opening a directory in an
 * editor that registers itself as a URL handler (VS Code, Cursor,
 * Windsurf, ...). All of these forks share VS Code's `vscode://file/`
 * addressing convention, so the same builder works for each — only the
 * scheme differs.
 *
 * Returns `null` if the path can't be resolved to a file URL.
 */
export function getEditorHref(dirPath: string, scheme: string): string | null {
  const fileHref = getFileHref(dirPath);
  if (!fileHref) {
    return null;
  }
  const pathname = new URL(fileHref).pathname;
  return `${scheme}://file${pathname}`;
}

/**
 * Wrap `text` in an OSC 8 hyperlink after validating the URI.
 *
 * Only `https:` and `file:` protocols are allowed. Returns plain `text`
 * when the URI is missing, invalid, or uses a disallowed protocol.
 *
 * @param uri       - The URI to link to (may be undefined/null).
 * @param text      - The visible text to display.
 * @param protocols - Allowed URL protocols (default: `['https:', 'file:']`).
 */
export function safeHyperlink(
  uri: string | undefined | null,
  text: string,
  protocols: string[] = ['https:', 'file:'],
): string {
  if (!uri) {
    return text;
  }

  const sanitizedUri = sanitizeDisplayText(uri);
  try {
    const parsed = new URL(sanitizedUri);
    if (!protocols.includes(parsed.protocol)) {
      return text;
    }
    return hyperlink(parsed.toString(), text);
  } catch {
    return text;
  }
}
