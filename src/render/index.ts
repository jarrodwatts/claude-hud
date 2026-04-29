import type { HudElement } from '../config.js';
import { DEFAULT_ELEMENT_ORDER, DEFAULT_MERGE_GROUPS } from '../config.js';
import type { RenderContext } from '../types.js';
import { renderSessionLine } from './session-line.js';
import { renderToolsLine } from './tools-line.js';
import { renderAgentsLine } from './agents-line.js';
import { renderTodosLine } from './todos-line.js';
import {
  renderIdentityLine,
  renderProjectLine,
  renderGitFilesLine,
  renderEnvironmentLine,
  renderPromptCacheLine,
  renderUsageLine,
  renderMemoryLine,
  renderSessionTokensLine,
} from './lines/index.js';
import { dim, RESET } from './colors.js';
import { getTerminalWidth, UNKNOWN_TERMINAL_WIDTH } from '../utils/terminal.js';
import { codePointCellWidth, isCjkAmbiguousWide } from './width.js';

const FALLBACK_TERMINAL_WIDTH = 120;
const MERGE_GROUP_ROW_BUDGET = 2;
const OPTIONAL_DROP_ORDER: HudElement[] = ['memory', 'promptCache', 'environment'];

type RenderDensity = 'normal' | 'compact';
type RenderElementOptions = {
  alignProgressLabels?: boolean;
  density?: RenderDensity;
};
type RenderedGroupLine = { element: HudElement; line: string };
type PackedMergeRow = { elements: HudElement[]; line: string };

// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_PATTERN = /^(?:\x1b\[[0-9;]*m|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\))/;
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_GLOBAL = /(?:\x1b\[[0-9;]*m|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\))/g;
const GRAPHEME_SEGMENTER = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null;

function stripAnsi(str: string): string {
  return str.replace(ANSI_ESCAPE_GLOBAL, '');
}

function splitAnsiTokens(str: string): Array<{ type: 'ansi' | 'text'; value: string }> {
  const tokens: Array<{ type: 'ansi' | 'text'; value: string }> = [];
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

function segmentGraphemes(text: string): string[] {
  if (!text) {
    return [];
  }
  if (!GRAPHEME_SEGMENTER) {
    return Array.from(text);
  }
  return Array.from(GRAPHEME_SEGMENTER.segment(text), segment => segment.segment);
}

function graphemeWidth(grapheme: string, ambiguousWide: boolean): number {
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
    if (codePoint !== undefined) {
      width = Math.max(width, codePointCellWidth(codePoint, ambiguousWide));
    } else {
      width = Math.max(width, 1);
    }
  }

  return hasVisibleBase ? width : 0;
}

function visualLength(str: string): number {
  const ambiguousWide = isCjkAmbiguousWide();
  let width = 0;
  for (const token of splitAnsiTokens(str)) {
    if (token.type === 'ansi') {
      continue;
    }
    for (const grapheme of segmentGraphemes(token.value)) {
      width += graphemeWidth(grapheme, ambiguousWide);
    }
  }
  return width;
}

function sliceVisible(str: string, maxVisible: number): string {
  if (maxVisible <= 0) {
    return '';
  }

  const ambiguousWide = isCjkAmbiguousWide();
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
      const graphemeCellWidth = graphemeWidth(grapheme, ambiguousWide);
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

function truncateToWidth(str: string, maxWidth: number): string {
  if (maxWidth <= 0 || visualLength(str) <= maxWidth) {
    return str;
  }

  const suffix = maxWidth >= 3 ? '...' : '.'.repeat(maxWidth);
  const keep = Math.max(0, maxWidth - suffix.length);
  return `${sliceVisible(str, keep)}${suffix}${RESET}`;
}

function parseColumns(value: unknown): number | null {
  const columns = typeof value === 'number'
    ? value
    : (typeof value === 'string' ? Number.parseInt(value, 10) : NaN);

  return Number.isFinite(columns) && columns > 0 ? Math.floor(columns) : null;
}

function withRenderColumns<T>(columns: number, fn: () => T): T {
  const originalColumns = process.env.COLUMNS;
  process.env.COLUMNS = String(columns);
  try {
    return fn();
  } finally {
    if (originalColumns === undefined) {
      delete process.env.COLUMNS;
    } else {
      process.env.COLUMNS = originalColumns;
    }
  }
}

function splitLineBySeparators(line: string): { segments: string[]; separators: string[] } {
  const segments: string[] = [];
  const separators: string[] = [];
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

function splitWrapParts(line: string): Array<{ separator: string; segment: string }> {
  const { segments, separators } = splitLineBySeparators(line);
  if (segments.length === 0) {
    return [];
  }

  let parts: Array<{ separator: string; segment: string }> = [{
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

function wrapLineToWidth(line: string, maxWidth: number): string[] {
  if (maxWidth <= 0 || visualLength(line) <= maxWidth) {
    return [line];
  }

  const parts = splitWrapParts(line);
  if (parts.length <= 1) {
    return [truncateToWidth(line, maxWidth)];
  }

  const wrapped: string[] = [];
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

// `length` is a target visual width in cells.
// `─` (U+2500) is East Asian Ambiguous-width: rendered as 2 cells in CJK
// terminals and 1 cell elsewhere. Repeating it `length` times in CJK mode
// would double the visual width and force the terminal to wrap.
function makeSeparator(length: number): string {
  const cellsPerDash = isCjkAmbiguousWide() ? 2 : 1;
  const repeats = Math.max(1, Math.floor(length / cellsPerDash));
  return dim('─'.repeat(repeats));
}

const ACTIVITY_ELEMENTS = new Set<HudElement>(['tools', 'agents', 'todos']);

function buildMergeGroupLookup(mergeGroups: HudElement[][]): Map<HudElement, Set<HudElement>> {
  const lookup = new Map<HudElement, Set<HudElement>>();

  for (const group of mergeGroups) {
    const groupSet = new Set(group);
    for (const element of group) {
      if (!lookup.has(element)) {
        lookup.set(element, groupSet);
      }
    }
  }

  return lookup;
}

function collectMergeSequence(
  elementOrder: HudElement[],
  startIndex: number,
  seen: Set<HudElement>,
  group: Set<HudElement>,
): HudElement[] {
  const sequence: HudElement[] = [];

  for (let index = startIndex; index < elementOrder.length; index += 1) {
    const element = elementOrder[index];
    if (seen.has(element) || !group.has(element)) {
      break;
    }
    sequence.push(element);
  }

  return sequence;
}

function collectActivityLines(ctx: RenderContext): string[] {
  const activityLines: string[] = [];
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

function renderElementLine(
  ctx: RenderContext,
  element: HudElement,
  options?: RenderElementOptions,
): string | null {
  const display = ctx.config?.display;
  const alignProgressLabels = options?.alignProgressLabels ?? false;
  const density = options?.density ?? 'normal';

  switch (element) {
    case 'project':
      return renderProjectLine(ctx);
    case 'context':
      return renderIdentityLine(ctx, alignProgressLabels);
    case 'usage':
      return renderUsageLine(ctx, alignProgressLabels, { density });
    case 'promptCache':
      return renderPromptCacheLine(ctx);
    case 'memory':
      return renderMemoryLine(ctx, { density });
    case 'environment':
      return renderEnvironmentLine(ctx);
    case 'tools':
      return display?.showTools === false ? null : renderToolsLine(ctx);
    case 'agents':
      return display?.showAgents === false ? null : renderAgentsLine(ctx);
    case 'todos':
      return display?.showTodos === false ? null : renderTodosLine(ctx);
  }
}

function renderGroupLines(
  ctx: RenderContext,
  mergeSequence: HudElement[],
  density: RenderDensity,
): RenderedGroupLine[] {
  return mergeSequence
    .map(groupedElement => ({
      element: groupedElement,
      line: renderElementLine(ctx, groupedElement, { density }),
    }))
    .filter(
      (entry): entry is RenderedGroupLine =>
        typeof entry.line === 'string' && entry.line.length > 0
    );
}

function packMergeRows(
  renderedGroupLines: RenderedGroupLine[],
  terminalWidth: number | null,
): PackedMergeRow[] {
  const widthIsReal = typeof terminalWidth === 'number' && terminalWidth > 0;
  const packedRows: PackedMergeRow[] = [];

  for (const { element: groupedElement, line } of renderedGroupLines) {
    const lastRow = packedRows[packedRows.length - 1];
    if (lastRow) {
      const candidate = `${lastRow.line} │ ${line}`;
      if (!widthIsReal || visualLength(candidate) <= terminalWidth) {
        lastRow.line = candidate;
        lastRow.elements.push(groupedElement);
        continue;
      }
    }
    packedRows.push({ elements: [groupedElement], line });
  }

  return packedRows;
}

function rowsFitBudget(rows: PackedMergeRow[]): boolean {
  return rows.length <= MERGE_GROUP_ROW_BUDGET;
}

function convertPackedRowsToLines(
  ctx: RenderContext,
  rows: PackedMergeRow[],
  density: RenderDensity,
): Array<{ line: string; isActivity: boolean }> {
  const lines: Array<{ line: string; isActivity: boolean }> = [];

  for (const row of rows) {
    let line = row.line;
    if (row.elements.length === 1) {
      const aligned = renderElementLine(ctx, row.elements[0], {
        alignProgressLabels: true,
        density,
      });
      if (aligned) {
        line = aligned;
      }
    }
    lines.push({
      line,
      isActivity: row.elements.some(element => ACTIVITY_ELEMENTS.has(element)),
    });
  }

  return lines;
}

function renderMergeSequence(
  ctx: RenderContext,
  mergeSequence: HudElement[],
  terminalWidth: number | null,
): Array<{ line: string; isActivity: boolean }> {
  const normalRows = packMergeRows(renderGroupLines(ctx, mergeSequence, 'normal'), terminalWidth);
  if (normalRows.length === 0 || rowsFitBudget(normalRows)) {
    return convertPackedRowsToLines(ctx, normalRows, 'normal');
  }

  let compactSequence = [...mergeSequence];
  let compactRows = packMergeRows(renderGroupLines(ctx, compactSequence, 'compact'), terminalWidth);
  if (rowsFitBudget(compactRows)) {
    return convertPackedRowsToLines(ctx, compactRows, 'compact');
  }

  for (const optionalElement of OPTIONAL_DROP_ORDER) {
    if (!compactSequence.includes(optionalElement)) {
      continue;
    }

    compactSequence = compactSequence.filter(element => element !== optionalElement);
    compactRows = packMergeRows(renderGroupLines(ctx, compactSequence, 'compact'), terminalWidth);
    if (rowsFitBudget(compactRows)) {
      return convertPackedRowsToLines(ctx, compactRows, 'compact');
    }
  }

  return convertPackedRowsToLines(ctx, compactRows, 'compact');
}

function renderCompact(ctx: RenderContext): string[] {
  const lines: string[] = [];

  const sessionLine = renderSessionLine(ctx);
  if (sessionLine) {
    lines.push(sessionLine);
  }

  return lines;
}

function renderExpanded(ctx: RenderContext, terminalWidth: number | null = null): Array<{ line: string; isActivity: boolean }> {
  const elementOrder = ctx.config?.elementOrder ?? DEFAULT_ELEMENT_ORDER;
  const mergeGroups = ctx.config?.display?.mergeGroups ?? DEFAULT_MERGE_GROUPS;
  const mergeGroupLookup = buildMergeGroupLookup(mergeGroups);
  const seen = new Set<HudElement>();
  const lines: Array<{ line: string; isActivity: boolean }> = [];

  for (let index = 0; index < elementOrder.length; index += 1) {
    const element = elementOrder[index];
    if (seen.has(element)) {
      continue;
    }

    const mergeGroup = mergeGroupLookup.get(element);
    if (mergeGroup) {
      const mergeSequence = collectMergeSequence(elementOrder, index, seen, mergeGroup);

      if (mergeSequence.length > 1) {
        index += mergeSequence.length - 1;
        for (const groupedElement of mergeSequence) {
          seen.add(groupedElement);
        }

        lines.push(...renderMergeSequence(ctx, mergeSequence, terminalWidth));

        continue;
      }
    }

    seen.add(element);

    const line = renderElementLine(ctx, element);
    if (!line) {
      continue;
    }

    lines.push({
      line,
      isActivity: ACTIVITY_ELEMENTS.has(element),
    });
  }

  // Git files line always goes last (pass width so it can hide itself if too narrow)
  const gitFilesLine = renderGitFilesLine(ctx, terminalWidth);
  if (gitFilesLine) {
    lines.push({ line: gitFilesLine, isActivity: false });
  }

  return lines;
}

export function render(ctx: RenderContext): void {
  const lineLayout = ctx.config?.lineLayout ?? 'expanded';
  const showSeparators = ctx.config?.showSeparators ?? false;
  const stdinWidth = parseColumns(ctx.stdin?.columns);
  const detectedWidth = getTerminalWidth({ preferEnv: true, fallback: UNKNOWN_TERMINAL_WIDTH });
  const terminalWidth = stdinWidth ?? detectedWidth ?? ctx.config?.maxWidth ?? FALLBACK_TERMINAL_WIDTH;

  withRenderColumns(terminalWidth, () => {
    let lines: string[];

    if (lineLayout === 'expanded') {
      const renderedLines = renderExpanded(ctx, terminalWidth);
      lines = renderedLines.map(({ line }) => line);

      // Session token usage (cumulative)
      if (ctx.config?.display?.showSessionTokens) {
        const sessionTokensLine = renderSessionTokensLine(ctx);
        if (sessionTokensLine) {
          lines.push(sessionTokensLine);
        }
      }

      if (showSeparators) {
        const firstActivityIndex = renderedLines.findIndex(({ isActivity }) => isActivity);
        if (firstActivityIndex > 0) {
          const separatorBaseWidth = Math.max(
            ...renderedLines
              .slice(0, firstActivityIndex)
              .map(({ line }) => visualLength(line)),
            20
          );
          const separatorWidth = terminalWidth
            ? Math.min(separatorBaseWidth, terminalWidth)
            : separatorBaseWidth;
          lines.splice(firstActivityIndex, 0, makeSeparator(separatorWidth));
        }
      }
    } else {
      const headerLines = renderCompact(ctx);
      const activityLines = collectActivityLines(ctx);
      lines = [...headerLines];

      if (showSeparators && activityLines.length > 0) {
        const maxWidth = Math.max(...headerLines.map(visualLength), 20);
        const separatorWidth = terminalWidth ? Math.min(maxWidth, terminalWidth) : maxWidth;
        lines.push(makeSeparator(separatorWidth));
      }

      lines.push(...activityLines);
    }

    const physicalLines = lines.flatMap(line => line.split('\n'));
    const visibleLines = physicalLines.flatMap(line => wrapLineToWidth(line, terminalWidth));

    for (const line of visibleLines) {
      const outputLine = `${RESET}${line}`;
      console.log(outputLine);
    }
  });
}
