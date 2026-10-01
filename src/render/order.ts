import type { FirstLineSegment } from '../config.js';
import type { Part } from './parts.js';

/**
 * Applies projectLineOrder to the keyed parts. Unkeyed parts keep their slots, a key's
 * parts stay together, and keys missing from `order` follow in their original order.
 */
export function orderParts(parts: Part[], order: readonly FirstLineSegment[]): string[] {
  const slots: number[] = [];
  const byKey = new Map<FirstLineSegment, string[]>();
  parts.forEach((part, index) => {
    if (part.key === null) return;
    slots.push(index);
    byKey.set(part.key, [...(byKey.get(part.key) ?? []), part.text]);
  });

  const reordered: string[] = [];
  for (const key of order) {
    reordered.push(...(byKey.get(key) ?? []));
    byKey.delete(key);
  }
  for (const texts of byKey.values()) reordered.push(...texts);

  const result = parts.map((part) => part.text);
  slots.forEach((slot, index) => {
    result[slot] = reordered[index];
  });
  return result;
}
