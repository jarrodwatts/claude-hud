import { AUTOCOMPACT_BUFFER } from './constants.js';
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
export function getContextPercent(stdin) {
    const usage = stdin.context_window?.current_usage;
    const size = stdin.context_window?.context_window_size;
    // Guard against missing data or invalid context window size
    if (!usage || !size || size <= AUTOCOMPACT_BUFFER) {
        return 0;
    }
    const totalTokens = (usage.input_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0);
    return Math.min(100, Math.round(((totalTokens + AUTOCOMPACT_BUFFER) / size) * 100));
}
export function getModelName(stdin) {
    return stdin.model?.display_name ?? stdin.model?.id ?? 'Unknown';
}
//# sourceMappingURL=stdin.js.map