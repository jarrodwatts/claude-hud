import type { StdinData } from './types.js';
import { AUTOCOMPACT_BUFFER } from './constants.js';

export async function readStdin(): Promise<StdinData | null> {
  if (process.stdin.isTTY) {
    return null;
  }

  const chunks: string[] = [];

  try {
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) {
      chunks.push(chunk as string);
    }
    const raw = chunks.join('');
    if (!raw.trim()) {
      return null;
    }
    return JSON.parse(raw) as StdinData;
  } catch {
    return null;
  }
}

/**
 * Returns raw context percentage (matches /context output).
 */
export function getContextPercent(stdin: StdinData): number {
  const usage = stdin.context_window?.current_usage;
  const size = stdin.context_window?.context_window_size;

  if (!usage || !size || size <= 0) {
    return 0;
  }

  const totalTokens =
    (usage.input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0);

  return Math.min(100, Math.round((totalTokens / size) * 100));
}

/**
 * Returns context percentage with autocompact buffer factored in.
 * Use this for warning thresholds - it represents "compact risk".
 */
export function getBufferedPercent(stdin: StdinData): number {
  const usage = stdin.context_window?.current_usage;
  const size = stdin.context_window?.context_window_size;

  if (!usage || !size || size <= 0) {
    return 0;
  }

  const totalTokens =
    (usage.input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0);

  return Math.min(100, Math.round(((totalTokens + AUTOCOMPACT_BUFFER) / size) * 100));
}

export function getModelName(stdin: StdinData): string {
  return stdin.model?.display_name ?? stdin.model?.id ?? 'Unknown';
}
