import type { HudElement } from '../config.js';
import { DEFAULT_ELEMENT_ORDER, DEFAULT_MERGE_GROUPS, DEFAULT_PROJECT_LINE_ORDER } from '../config.js';
import type { Frame } from './frame.js';
import { activityLine } from './activity.js';
import { separatorLine, visibleWidth } from './ansi.js';
import { contextLine } from './context.js';
import type { LabelAlign } from './labels.js';
import { addedDirsLine, cacheHitRateLine, environmentLine, memoryLine, promptCacheLine, sessionTimeLine } from './lines.js';
import { orderParts } from './order.js';
import {
  advisorPart, authPart, compactionsPart, costPart, customLinePart, durationPart, extraPart, modelBadge,
  projectParts, sessionNamePart, sessionTokensSummary, speedPart, versionPart, type Part,
} from './parts.js';
import { usageParts } from './usage.js';
import { gitFilesLine } from './vcs.js';
import { t } from '../i18n/index.js';

const ACTIVITY = new Set<HudElement>(['tools', 'skills', 'mcp', 'agents', 'todos']);

function projectLine(f: Frame): string | null {
  const display = f.config?.display;
  const parts: Part[] = [];
  const add = (text: string | null, key: Part['key'] = null): void => {
    if (text) parts.push({ key, text });
  };
  add(customLinePart(f, 'first'));
  if (display?.showModel !== false) add(modelBadge(f), 'model');
  for (const part of projectParts(f, 'expanded')) add(part, 'project');
  add(advisorPart(f), 'advisor');
  add(sessionNamePart(f), 'sessionName');
  add(versionPart(f), 'version');
  add(extraPart(f), 'extra');
  add(durationPart(f), 'duration');
  add(costPart(f), 'cost');
  add(speedPart(f), 'speed');
  add(authPart(f), 'auth');
  add(customLinePart(f, 'last'));
  if (parts.length === 0) return null;
  return orderParts(parts, f.config?.projectLineOrder ?? DEFAULT_PROJECT_LINE_ORDER).join(' │ ');
}

function elementLine(f: Frame, element: HudElement, align: LabelAlign = {}): string | null {
  switch (element) {
    case 'project': return projectLine(f);
    case 'addedDirs': return addedDirsLine(f);
    case 'context': return contextLine(f, align);
    case 'usage': return usageParts(f, 'expanded', align)?.join(' | ') ?? null;
    case 'promptCache': return promptCacheLine(f);
    case 'cacheHitRate': return cacheHitRateLine(f);
    case 'memory': return memoryLine(f, align);
    case 'environment': return environmentLine(f);
    case 'sessionTime': return sessionTimeLine(f);
    default: return activityLine(f, element);
  }
}

// Pads before the first rightAlign element so the rest of the row sits flush right;
// null when nothing precedes it. Callers only align rows that fit, so the gap is at least 3.
function alignRight(entries: Array<{ element: HudElement; line: string }>, rightAlign: Set<HudElement>, width: number): string | null {
  const split = entries.findIndex(({ element }) => rightAlign.has(element));
  if (split <= 0) return null;
  const left = entries.slice(0, split).map(({ line }) => line).join(' │ ');
  const right = entries.slice(split).map(({ line }) => line).join(' │ ');
  return `${left}${' '.repeat(width - visibleWidth(left) - visibleWidth(right))}${right}`;
}

interface Row {
  line: string;
  activity: boolean;
}

/** The expanded layout: one row per element in elementOrder, merging adjacent mergeGroups members. */
export function expandedLines(f: Frame): string[] {
  const order = f.config?.elementOrder ?? DEFAULT_ELEMENT_ORDER;
  const groups = new Map<HudElement, Set<HudElement>>();
  for (const group of f.config?.display?.mergeGroups ?? DEFAULT_MERGE_GROUPS) {
    const members = new Set(group);
    for (const element of group) if (!groups.has(element)) groups.set(element, members);
  }
  const rightAlign = new Set<HudElement>(f.config?.display?.rightAlign ?? []);

  // A visible memory bar widens the label column of the other bars so they line up.
  const memoryVisible = order.includes('memory') && f.config?.display?.showMemoryUsage === true && f.memoryUsage != null;
  const otherBarVisible = order.includes('context') || (order.includes('usage') && usageParts(f, 'expanded') !== null);
  const separateAlign: LabelAlign = memoryVisible && otherBarVisible ? { align: true, includeMemoryInWidth: true } : {};
  const stackedAlign: LabelAlign = { align: true, includeMemoryInWidth: memoryVisible };

  const rows: Row[] = [];
  const seen = new Set<HudElement>();
  for (let index = 0; index < order.length; index += 1) {
    const element = order[index];
    if (seen.has(element)) continue;

    const group = groups.get(element);
    const sequence: HudElement[] = [];
    for (let next = index; group && next < order.length && group.has(order[next]) && !seen.has(order[next]); next += 1) {
      sequence.push(order[next]);
    }

    if (sequence.length <= 1) {
      seen.add(element);
      const line = elementLine(f, element, separateAlign);
      if (line) rows.push({ line, activity: ACTIVITY.has(element) });
      continue;
    }

    index += sequence.length - 1;
    sequence.forEach((member) => seen.add(member));
    // Memory only widens this row's labels when its own bar is on a separate row.
    const groupAlign = memoryVisible && !sequence.includes('memory') ? separateAlign : {};
    const entries = sequence
      .map((member) => ({ element: member, line: elementLine(f, member, groupAlign) }))
      .filter((entry): entry is { element: HudElement; line: string } => !!entry.line);

    if (entries.length === 1) {
      const [{ element: only, line }] = entries;
      rows.push({ line: elementLine(f, only, separateAlign) ?? line, activity: ACTIVITY.has(only) });
      continue;
    }
    if (entries.length === 0) continue;

    const combined = entries.map(({ line }) => line).join(' │ ');
    if (f.width === null || visibleWidth(combined) <= f.width) {
      const aligned = f.width === null ? null : alignRight(entries, rightAlign, f.width);
      rows.push({ line: aligned ?? combined, activity: entries.some(({ element: member }) => ACTIVITY.has(member)) });
    } else {
      for (const { element: member, line } of entries) {
        rows.push({ line: elementLine(f, member, stackedAlign) ?? line, activity: ACTIVITY.has(member) });
      }
    }
  }

  const lines = rows.map(({ line }) => line);
  const gitFiles = gitFilesLine(f);
  if (gitFiles) lines.push(gitFiles);
  if (f.config?.display?.showSessionTokens) {
    const tokens = sessionTokensSummary(f, t('label.tokens'));
    if (tokens) lines.push(tokens);
  }
  const compactions = compactionsPart(f);
  if (compactions) lines.push(compactions);

  const firstActivity = rows.findIndex(({ activity }) => activity);
  if (f.config?.showSeparators && firstActivity > 0) {
    const widest = Math.max(...rows.slice(0, firstActivity).map(({ line }) => visibleWidth(line)), 20);
    lines.splice(firstActivity, 0, separatorLine(f.width ? Math.min(widest, f.width) : widest));
  }
  return lines;
}
