import type { FirstLineSegment } from '../config.ts';
import type { Part } from './parts.ts';

/**
 * Applies projectLineOrder: the listed keys' parts form one run, in that order, at the first keyed
 * slot. Everything else (unkeyed parts and unlisted keys) keeps its original relative order around it.
 */
export function orderParts(parts: Part[], order: readonly FirstLineSegment[]): string[] {
  const first = parts.findIndex((part) => part.key !== null);
  if (first === -1 || order.length === 0) return parts.map((part) => part.text);

  const listed = new Set(order);
  const run = order.flatMap((key) => parts.filter((part) => part.key === key).map((part) => part.text));
  const rest = parts.slice(first).filter((part) => part.key === null || !listed.has(part.key));
  return [...parts.slice(0, first).map((part) => part.text), ...run, ...rest.map((part) => part.text)];
}
