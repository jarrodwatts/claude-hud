import type { StdinData } from './types.js';
import { AUTOCOMPACT_BUFFER } from './constants.js';

// All modern Claude models have 200k context window
const DEFAULT_CONTEXT_SIZE = 200000;

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

export function getContextPercent(stdin: StdinData): number {
  const usage = stdin.context_window?.current_usage;
  let size = stdin.context_window?.context_window_size;

  // Guard against missing data or invalid context window size
  if (!usage || !size || size <= AUTOCOMPACT_BUFFER) {
    return 0;
  }

  // Fix: Claude Code may report incorrect context size, all modern models have 200k
  if (size < DEFAULT_CONTEXT_SIZE) {
    size = DEFAULT_CONTEXT_SIZE;
  }

  const totalTokens =
    (usage.input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0);

  // Fix: don't add AUTOCOMPACT_BUFFER - /context command doesn't include it
  return Math.min(100, Math.round((totalTokens / size) * 100));
}

export function getModelName(stdin: StdinData): string {
  return stdin.model?.display_name ?? stdin.model?.id ?? 'Unknown';
}
