/**
 * Wrap `text` in an OSC 8 hyperlink pointing to `uri`.
 */
export declare function hyperlink(uri: string, text: string): string;
/**
 * Convert a filesystem path to a `file://` URL string.
 * Returns `null` on failure.
 */
export declare function getFileHref(filePath: string): string | null;
/**
 * Build a `<scheme>://file/<path>` URI for opening a directory in an
 * editor that registers itself as a URL handler (VS Code, Cursor,
 * Windsurf, ...). All of these forks share VS Code's `vscode://file/`
 * addressing convention, so the same builder works for each — only the
 * scheme differs.
 *
 * `windowId=_blank` tells the VS Code family's URI handler to open a new
 * window instead of reusing whichever window last had focus — without it,
 * the link silently reuses an existing window, which reads as broken when
 * the user already has one open elsewhere.
 *
 * Returns `null` if the path can't be resolved to a file URL.
 */
export declare function getEditorHref(dirPath: string, scheme: string): string | null;
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
export declare function safeHyperlink(uri: string | undefined | null, text: string, protocols?: string[]): string;
//# sourceMappingURL=hyperlinks.d.ts.map