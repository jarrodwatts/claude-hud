import { renderSessionLine } from './session-line.js';
import { renderToolsLine } from './tools-line.js';
import { renderAgentsLine } from './agents-line.js';
import { renderTodosLine } from './todos-line.js';
import { renderIdentityLine, renderProjectLine, renderEnvironmentLine, renderUsageLine, } from './lines/index.js';
import { dim, RESET } from './colors.js';
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_PATTERN = /^\x1b\[[0-9;]*m/;
const ANSI_ESCAPE_GLOBAL = /\x1b\[[0-9;]*m/g;
const GRAPHEME_SEGMENTER = typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;
function stripAnsi(str) {
    return str.replace(ANSI_ESCAPE_GLOBAL, '');
}
function getTerminalWidth() {
    const stdoutColumns = process.stdout?.columns;
    if (typeof stdoutColumns === 'number' && Number.isFinite(stdoutColumns) && stdoutColumns > 0) {
        return Math.floor(stdoutColumns);
    }
    const envColumns = Number.parseInt(process.env.COLUMNS ?? '', 10);
    if (Number.isFinite(envColumns) && envColumns > 0) {
        return envColumns;
    }
    return null;
}
function splitAnsiTokens(str) {
    const tokens = [];
    let i = 0;
    while (i < str.length) {
        const ansiMatch = ANSI_ESCAPE_PATTERN.exec(str.slice(i));
        if (ansiMatch) {
            tokens.push({ type: 'ansi', value: ansiMatch[0] });
            i += ansiMatch[0].length;
            continue;
        }
        let j = i;
        while (j < str.length) {
            const nextAnsi = ANSI_ESCAPE_PATTERN.exec(str.slice(j));
            if (nextAnsi) {
                break;
            }
            j += 1;
        }
        tokens.push({ type: 'text', value: str.slice(i, j) });
        i = j;
    }
    return tokens;
}
function segmentGraphemes(text) {
    if (!text) {
        return [];
    }
    if (!GRAPHEME_SEGMENTER) {
        return Array.from(text);
    }
    return Array.from(GRAPHEME_SEGMENTER.segment(text), segment => segment.segment);
}
function isWideCodePoint(codePoint) {
    return codePoint >= 0x1100 && (codePoint <= 0x115F || // Hangul Jamo
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
        (codePoint >= 0x20000 && codePoint <= 0x3FFFD));
}
function graphemeWidth(grapheme) {
    if (!grapheme || /^\p{Control}$/u.test(grapheme)) {
        return 0;
    }
    // Emoji glyphs and ZWJ sequences generally render as double-width.
    if (/\p{Extended_Pictographic}/u.test(grapheme)) {
        return 2;
    }
    let hasVisibleBase = false;
    let width = 0;
    for (const char of Array.from(grapheme)) {
        if (/^\p{Mark}$/u.test(char) || char === '\u200D' || char === '\uFE0F') {
            continue;
        }
        hasVisibleBase = true;
        const codePoint = char.codePointAt(0);
        if (codePoint !== undefined && isWideCodePoint(codePoint)) {
            width = Math.max(width, 2);
        }
        else {
            width = Math.max(width, 1);
        }
    }
    return hasVisibleBase ? width : 0;
}
function visualLength(str) {
    let width = 0;
    for (const token of splitAnsiTokens(str)) {
        if (token.type === 'ansi') {
            continue;
        }
        for (const grapheme of segmentGraphemes(token.value)) {
            width += graphemeWidth(grapheme);
        }
    }
    return width;
}
function sliceVisible(str, maxVisible) {
    if (maxVisible <= 0) {
        return '';
    }
    let result = '';
    let visibleWidth = 0;
    let done = false;
    let i = 0;
    while (i < str.length && !done) {
        const ansiMatch = ANSI_ESCAPE_PATTERN.exec(str.slice(i));
        if (ansiMatch) {
            result += ansiMatch[0];
            i += ansiMatch[0].length;
            continue;
        }
        let j = i;
        while (j < str.length) {
            const nextAnsi = ANSI_ESCAPE_PATTERN.exec(str.slice(j));
            if (nextAnsi) {
                break;
            }
            j += 1;
        }
        const plainChunk = str.slice(i, j);
        for (const grapheme of segmentGraphemes(plainChunk)) {
            const graphemeCellWidth = graphemeWidth(grapheme);
            if (visibleWidth + graphemeCellWidth > maxVisible) {
                done = true;
                break;
            }
            result += grapheme;
            visibleWidth += graphemeCellWidth;
        }
        i = j;
    }
    return result;
}
function truncateToWidth(str, maxWidth) {
    if (maxWidth <= 0 || visualLength(str) <= maxWidth) {
        return str;
    }
    const suffix = maxWidth >= 3 ? '...' : '.'.repeat(maxWidth);
    const keep = Math.max(0, maxWidth - suffix.length);
    return `${sliceVisible(str, keep)}${suffix}${RESET}`;
}
function splitLineBySeparators(line) {
    const segments = [];
    const separators = [];
    let currentStart = 0;
    let i = 0;
    while (i < line.length) {
        const ansiMatch = ANSI_ESCAPE_PATTERN.exec(line.slice(i));
        if (ansiMatch) {
            i += ansiMatch[0].length;
            continue;
        }
        const separator = line.startsWith(' | ', i)
            ? ' | '
            : (line.startsWith(' │ ', i) ? ' │ ' : null);
        if (separator) {
            segments.push(line.slice(currentStart, i));
            separators.push(separator);
            i += separator.length;
            currentStart = i;
            continue;
        }
        i += 1;
    }
    segments.push(line.slice(currentStart));
    return { segments, separators };
}
function splitWrapParts(line) {
    const { segments, separators } = splitLineBySeparators(line);
    if (segments.length === 0) {
        return [];
    }
    let parts = [{
            separator: '',
            segment: segments[0],
        }];
    for (let segmentIndex = 1; segmentIndex < segments.length; segmentIndex += 1) {
        parts.push({
            separator: separators[segmentIndex - 1] ?? ' | ',
            segment: segments[segmentIndex],
        });
    }
    // Keep the leading [model | provider] block together.
    // This avoids splitting inside the model badge while still splitting
    // separators elsewhere in the line.
    const firstVisible = stripAnsi(parts[0].segment).trimStart();
    const firstHasOpeningBracket = firstVisible.startsWith('[');
    const firstHasClosingBracket = stripAnsi(parts[0].segment).includes(']');
    if (firstHasOpeningBracket && !firstHasClosingBracket && parts.length > 1) {
        let mergedSegment = parts[0].segment;
        let consumeIndex = 1;
        while (consumeIndex < parts.length) {
            const nextPart = parts[consumeIndex];
            mergedSegment += `${nextPart.separator}${nextPart.segment}`;
            consumeIndex += 1;
            if (stripAnsi(nextPart.segment).includes(']')) {
                break;
            }
        }
        parts = [
            { separator: '', segment: mergedSegment },
            ...parts.slice(consumeIndex),
        ];
    }
    return parts;
}
function wrapLineToWidth(line, maxWidth) {
    if (maxWidth <= 0 || visualLength(line) <= maxWidth) {
        return [line];
    }
    const parts = splitWrapParts(line);
    if (parts.length <= 1) {
        return [truncateToWidth(line, maxWidth)];
    }
    const wrapped = [];
    let current = parts[0].segment;
    for (const part of parts.slice(1)) {
        const candidate = `${current}${part.separator}${part.segment}`;
        if (visualLength(candidate) <= maxWidth) {
            current = candidate;
            continue;
        }
        wrapped.push(truncateToWidth(current, maxWidth));
        current = part.segment;
    }
    if (current) {
        wrapped.push(truncateToWidth(current, maxWidth));
    }
    return wrapped;
}
function makeSeparator(length) {
    return dim('─'.repeat(Math.max(length, 1)));
}
function collectActivityLines(ctx) {
    const activityLines = [];
    const display = ctx.config?.display;
    if (display?.showTools !== false) {
        const toolsLine = renderToolsLine(ctx);
        if (toolsLine) {
            activityLines.push(toolsLine);
        }
    }
    if (display?.showAgents !== false) {
        const agentsLine = renderAgentsLine(ctx);
        if (agentsLine) {
            activityLines.push(agentsLine);
        }
    }
    if (display?.showTodos !== false) {
        const todosLine = renderTodosLine(ctx);
        if (todosLine) {
            activityLines.push(todosLine);
        }
    }
    return activityLines;
}
function renderCompact(ctx) {
    const lines = [];
    const sessionLine = renderSessionLine(ctx);
    if (sessionLine) {
        lines.push(sessionLine);
    }
    return lines;
}
function renderExpanded(ctx) {
    const lines = [];
    const projectLine = renderProjectLine(ctx);
    if (projectLine) {
        lines.push(projectLine);
    }
    const identityLine = renderIdentityLine(ctx);
    const usageLine = renderUsageLine(ctx);
    if (identityLine && usageLine) {
        lines.push(`${identityLine} \u2502 ${usageLine}`);
    }
    else if (identityLine) {
        lines.push(identityLine);
    }
    const environmentLine = renderEnvironmentLine(ctx);
    if (environmentLine) {
        lines.push(environmentLine);
    }
    return lines;
}
export function render(ctx) {
    const lineLayout = ctx.config?.lineLayout ?? 'expanded';
    const showSeparators = ctx.config?.showSeparators ?? false;
    const terminalWidth = getTerminalWidth();
    const headerLines = lineLayout === 'expanded'
        ? renderExpanded(ctx)
        : renderCompact(ctx);
    const activityLines = collectActivityLines(ctx);
    const lines = [...headerLines];
    if (showSeparators && activityLines.length > 0) {
        const maxWidth = Math.max(...headerLines.map(visualLength), 20);
        const separatorWidth = terminalWidth ? Math.min(maxWidth, terminalWidth) : maxWidth;
        lines.push(makeSeparator(separatorWidth));
    }
    lines.push(...activityLines);
    const physicalLines = lines.flatMap(line => line.split('\n'));
    const visibleLines = terminalWidth
        ? physicalLines.flatMap(line => wrapLineToWidth(line, terminalWidth))
        : physicalLines;
    for (const line of visibleLines) {
        const outputLine = `${RESET}${line.replace(/ /g, '\u00A0')}`;
        console.log(outputLine);
    }
}
//# sourceMappingURL=index.js.map