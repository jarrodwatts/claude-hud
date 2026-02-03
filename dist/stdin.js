import { AUTOCOMPACT_BUFFER_PERCENT } from './constants.js';
export async function readStdin() {
    if (process.stdin.isTTY) {
        return null;
    }
    const chunks = [];
    try {
        process.stdin.setEncoding('utf8');
        for await (const chunk of process.stdin) {
            chunks.push(chunk);
        }
        const raw = chunks.join('');
        if (!raw.trim()) {
            return null;
        }
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
export function getTotalTokens(stdin) {
    const usage = stdin.context_window?.current_usage;
    return ((usage?.input_tokens ?? 0) +
        (usage?.cache_creation_input_tokens ?? 0) +
        (usage?.cache_read_input_tokens ?? 0));
}
/**
 * Get native percentage from Claude Code v2.1.6+ if available.
 * Returns null if not available or invalid, triggering fallback to manual calculation.
 */
function getNativePercent(stdin) {
    const nativePercent = stdin.context_window?.used_percentage;
    if (typeof nativePercent === 'number' && !Number.isNaN(nativePercent)) {
        return Math.min(100, Math.max(0, Math.round(nativePercent)));
    }
    return null;
}
export function getContextPercent(stdin) {
    // Prefer native percentage (v2.1.6+) - accurate and matches /context
    const native = getNativePercent(stdin);
    if (native !== null) {
        return native;
    }
    // Fallback: manual calculation without buffer
    const size = stdin.context_window?.context_window_size;
    if (!size || size <= 0) {
        return 0;
    }
    const totalTokens = getTotalTokens(stdin);
    return Math.min(100, Math.round((totalTokens / size) * 100));
}
export function getBufferedPercent(stdin) {
    // Prefer native percentage (v2.1.6+) - accurate and matches /context
    // Native percentage already accounts for context correctly, no buffer needed
    const native = getNativePercent(stdin);
    if (native !== null) {
        return native;
    }
    // Fallback: manual calculation with buffer for older Claude Code versions
    const size = stdin.context_window?.context_window_size;
    if (!size || size <= 0) {
        return 0;
    }
    const totalTokens = getTotalTokens(stdin);
    const buffer = size * AUTOCOMPACT_BUFFER_PERCENT;
    return Math.min(100, Math.round(((totalTokens + buffer) / size) * 100));
}
export function getModelName(stdin) {
    return stdin.model?.display_name ?? stdin.model?.id ?? 'Unknown';
}
export function isBedrockModelId(modelId) {
    if (!modelId) {
        return false;
    }
    const normalized = modelId.toLowerCase();
    return normalized.includes('anthropic.claude-');
}
export function getProviderLabel(stdin) {
    if (isBedrockModelId(stdin.model?.id)) {
        return 'Bedrock';
    }
    return null;
}
//# sourceMappingURL=stdin.js.map