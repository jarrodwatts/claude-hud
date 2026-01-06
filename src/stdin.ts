import type { StdinData } from './types.js';
import { AUTOCOMPACT_BUFFER } from './constants.js';

// A constant for the fallback model name improves readability and maintainability.
const DEFAULT_MODEL_NAME = 'Unknown';

/**
 * Reads and parses JSON data from standard input.
 * @returns A promise that resolves to the parsed StdinData object, or null if
 * stdin is a TTY, the input is empty, or a parsing error occurs.
 */
export async function readStdin(): Promise<StdinData | null> {
  // If the process is running in a terminal, there's no piped input.
  if (process.stdin.isTTY) {
    return null;
  }

  const chunks: string[] = [];

  try {
    process.stdin.setEncoding('utf8');
    // Using for-await...of is the modern and efficient way to handle streams.
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const rawInput = chunks.join('');

    // Return null for empty or whitespace-only input.
    if (!rawInput.trim()) {
      return null;
    }

    // Attempt to parse the JSON string.
    return JSON.parse(rawInput) as StdinData;
  } catch (error) {
    // CRITICAL IMPROVEMENT: Log the error instead of silently ignoring it.
    // This is invaluable for debugging malformed JSON input from users or other processes.
    console.error('Failed to read or parse stdin:', error);
    return null;
  }
}

/**
 * Calculates the percentage of the context window currently in use.
 * The calculation includes an auto-compact buffer to ensure the operation
 * stays within a safe limit before hitting the absolute maximum.
 * @param stdin - The stdin data object.
 * @returns The context usage as a percentage (0-100), or 0 if data is invalid.
 */
export function getContextPercent(stdin: StdinData): number {
  const usage = stdin.context_window?.current_usage;
  const size = stdin.context_window?.context_window_size;

  // Guard against missing data or an invalid context window size.
  // The size must be larger than the buffer to be considered valid.
  if (!usage || !size || size <= AUTOCOMPACT_BUFFER) {
    return 0;
  }

  // Sum all relevant token types for total usage.
  const totalTokens =
    (usage.input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0);

  // Calculate the percentage, adding the buffer and capping the result at 100.
  const usageWithBuffer = totalTokens + AUTOCOMPACT_BUFFER;
  const percentUsed = (usageWithBuffer / size) * 100;

  return Math.min(100, Math.round(percentUsed));
}

/**
 * Retrieves the model's display name, falling back to its ID, then a default.
 * @param stdin - The stdin data object.
 * @returns The model name as a string.
 */
export function getModelName(stdin: StdinData): string {
  return (
    stdin.model?.display_name ??
    stdin.model?.id ??
    DEFAULT_MODEL_NAME
  );
}
