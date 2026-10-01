import type { HudElement } from '../config.js';
import { DEFAULT_ELEMENT_ORDER, DEFAULT_MERGE_GROUPS } from '../config.js';
import type { RenderContext } from '../types.js';
import { renderSessionLine } from './session-line.js';
import { renderToolsLine } from './tools-line.js';
import { renderSkillsLine, renderMcpLine } from './skills-mcp-line.js';
import { renderAgentsLine } from './agents-line.js';
import { renderTodosLine } from './todos-line.js';
import {
  renderIdentityLine,
  renderProjectLine,
  renderAddedDirsLine,
  renderGitFilesLine,
  renderEnvironmentLine,
  renderPromptCacheLine,
  renderCacheHitRateLine,
  renderUsageLine,
  renderMemoryLine,
  renderSessionTokensLine,
  renderCompactionsLine,
  renderSessionTimeLine,
} from './lines/index.js';
import { RESET } from './colors.js';
import { visibleWidth as visualLength, wrapToWidth as wrapLineToWidth, separatorLine as makeSeparator } from './ansi.js';
import { getTerminalWidth, UNKNOWN_TERMINAL_WIDTH } from '../utils/terminal.js';
import type { ProgressLabelOptions } from './lines/label-align.js';

const ACTIVITY_ELEMENTS = new Set<HudElement>(['tools', 'skills', 'mcp', 'agents', 'todos']);

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

// Treat the first configured element as the start of an order-preserving
// right zone, padding the gap before it with spaces. Returns null when alignment does
// not apply — no configured elements on either side, or not enough room for
// at least one space between the two halves — so the caller falls back to the
// normal separator join.
function alignGroupRight(
  entries: Array<{ element: HudElement; line: string }>,
  rightAlign: Set<HudElement>,
  terminalWidth: number,
): string | null {
  if (rightAlign.size === 0) {
    return null;
  }

  const splitIndex = entries.findIndex(({ element }) => rightAlign.has(element));
  if (splitIndex <= 0) {
    return null;
  }

  const leftEntries = entries.slice(0, splitIndex);
  const rightEntries = entries.slice(splitIndex);

  if (leftEntries.length === 0 || rightEntries.length === 0) {
    return null;
  }

  const leftText = leftEntries.map(({ line }) => line).join(' │ ');
  const rightText = rightEntries.map(({ line }) => line).join(' │ ');
  const gap = terminalWidth - visualLength(leftText) - visualLength(rightText);

  if (gap < 1) {
    return null;
  }

  return `${leftText}${' '.repeat(gap)}${rightText}`;
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

  if (display?.showSkills === true) {
    const skillsLine = renderSkillsLine(ctx);
    if (skillsLine) {
      activityLines.push(skillsLine);
    }
  }

  if (display?.showMcp === true) {
    const mcpLine = renderMcpLine(ctx);
    if (mcpLine) {
      activityLines.push(mcpLine);
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
  labelOptions: ProgressLabelOptions = {},
): string | null {
  const display = ctx.config?.display;

  switch (element) {
    case 'project':
      return renderProjectLine(ctx);
    case 'addedDirs':
      return renderAddedDirsLine(ctx);
    case 'context':
      return renderIdentityLine(ctx, labelOptions);
    case 'usage':
      return renderUsageLine(ctx, labelOptions);
    case 'promptCache':
      return renderPromptCacheLine(ctx);
    case 'cacheHitRate':
      return renderCacheHitRateLine(ctx);
    case 'memory':
      return renderMemoryLine(ctx, labelOptions);
    case 'environment':
      return renderEnvironmentLine(ctx);
    case 'tools':
      return display?.showTools === false ? null : renderToolsLine(ctx);
    case 'skills':
      return display?.showSkills === true ? renderSkillsLine(ctx) : null;
    case 'mcp':
      return display?.showMcp === true ? renderMcpLine(ctx) : null;
    case 'agents':
      return display?.showAgents === false ? null : renderAgentsLine(ctx);
    case 'todos':
      return display?.showTodos === false ? null : renderTodosLine(ctx);
    case 'sessionTime':
      return renderSessionTimeLine(ctx);
  }
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
  const rightAlign = new Set<HudElement>(ctx.config?.display?.rightAlign ?? []);
  const memoryLineVisible = elementOrder.includes('memory')
    && ctx.config?.display?.showMemoryUsage === true
    && ctx.memoryUsage != null;
  const otherProgressLineVisible = elementOrder.includes('context')
    || (elementOrder.includes('usage') && renderUsageLine(ctx) != null);
  const separateMemoryLabelOptions: ProgressLabelOptions | undefined = memoryLineVisible
    && otherProgressLineVisible
    ? { align: true, includeMemoryInWidth: true }
    : undefined;
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

        // A memory label only needs to influence a group's padding when its
        // progress bar is rendered on a different row. If memory is part of
        // this combined row, keep the candidate compact and align only if the
        // row is later forced to stack.
        const groupLabelOptions = memoryLineVisible && !mergeSequence.includes('memory')
          ? separateMemoryLabelOptions
          : undefined;
        const renderedGroupLines = mergeSequence
          .map(groupedElement => ({
            element: groupedElement,
            line: renderElementLine(ctx, groupedElement, groupLabelOptions),
          }))
          .filter(
            (entry): entry is { element: HudElement; line: string } =>
              typeof entry.line === 'string' && entry.line.length > 0
          );

        if (renderedGroupLines.length > 1) {
          const combinedLine = renderedGroupLines.map(({ line }) => line).join(' │ ');
          const widthIsReal = terminalWidth !== UNKNOWN_TERMINAL_WIDTH;
          // The fit check uses the unpadded join: right-alignment only inserts
          // spaces, so it never changes whether the content itself fits.
          const canCombine = !widthIsReal || visualLength(combinedLine) <= terminalWidth;
          const alignedLine = widthIsReal
            ? alignGroupRight(renderedGroupLines, rightAlign, terminalWidth)
            : null;

          if (canCombine) {
            lines.push({
              line: alignedLine ?? combinedLine,
              isActivity: renderedGroupLines.some(({ element: groupedElement }) => ACTIVITY_ELEMENTS.has(groupedElement)),
            });
          } else {
            for (const { element: groupedElement, line } of renderedGroupLines) {
              const stackedLine = renderElementLine(ctx, groupedElement, {
                align: true,
                includeMemoryInWidth: memoryLineVisible,
              }) ?? line;
              lines.push({
                line: stackedLine,
                isActivity: ACTIVITY_ELEMENTS.has(groupedElement),
              });
            }
          }
        } else if (renderedGroupLines.length === 1) {
          const [{ element: groupedElement, line }] = renderedGroupLines;
          const separateLine = renderElementLine(
            ctx,
            groupedElement,
            separateMemoryLabelOptions,
          ) ?? line;
          lines.push({
            line: separateLine,
            isActivity: ACTIVITY_ELEMENTS.has(groupedElement),
          });
        }

        continue;
      }
    }

    seen.add(element);

    const line = renderElementLine(ctx, element, separateMemoryLabelOptions);
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
  const detectedWidth = getTerminalWidth({ preferEnv: true, fallback: UNKNOWN_TERMINAL_WIDTH });
  const configuredMaxWidth = ctx.config?.maxWidth ?? UNKNOWN_TERMINAL_WIDTH;
  const terminalWidth = ctx.config?.forceMaxWidth && configuredMaxWidth !== UNKNOWN_TERMINAL_WIDTH
    ? configuredMaxWidth
    : (detectedWidth ?? configuredMaxWidth ?? UNKNOWN_TERMINAL_WIDTH);

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

    // Compaction count (opt-in, hidden until the first compaction)
    const compactionsLine = renderCompactionsLine(ctx);
    if (compactionsLine) {
      lines.push(compactionsLine);
    }

    // Advisor is rendered inline on the project line; see renderProjectLine.

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
  // Only wrap when terminal width is real (known). When width is the
  // UNKNOWN_TERMINAL_WIDTH fallback, wrapping would use an arbitrary value
  // and produce incorrect line breaks.
  const wrapWidth = terminalWidth !== UNKNOWN_TERMINAL_WIDTH ? (terminalWidth ?? 0) : 0;
  const visibleLines = physicalLines.flatMap(line => wrapLineToWidth(line, wrapWidth));

  for (const line of visibleLines) {
    const outputLine = `${RESET}${line}`;
    console.log(outputLine);
  }
}
