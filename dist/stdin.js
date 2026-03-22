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
/**
 * Get the effective context window size, checking for model-based overrides.
 * Matching order: model.id → model.display_name → getModelName() (normalized).
 * Priority: exact match first, then longer substring patterns first.
 */
export function getEffectiveContextSize(stdin, config) {
    const stdinSize = stdin.context_window?.context_window_size ?? 0;
    const overrides = config?.display?.contextSizeOverrides;
    if (!overrides || Object.keys(overrides).length === 0) {
        return stdinSize;
    }
    const candidates = [
        stdin.model?.id?.trim(),
        stdin.model?.display_name?.trim(),
        getModelName(stdin),
    ].filter((c) => !!c);
    // Sort patterns by length descending so longer (more specific) patterns match first
    const sortedEntries = Object.entries(overrides)
        .sort((a, b) => b[0].length - a[0].length);
    // Pass 1: exact match (case-insensitive)
    for (const [pattern, size] of sortedEntries) {
        const lowerPattern = pattern.toLowerCase();
        for (const candidate of candidates) {
            if (candidate.toLowerCase() === lowerPattern) {
                return size;
            }
        }
    }
    // Pass 2: substring match, longer patterns first
    for (const [pattern, size] of sortedEntries) {
        const lowerPattern = pattern.toLowerCase();
        for (const candidate of candidates) {
            if (candidate.toLowerCase().includes(lowerPattern)) {
                return size;
            }
        }
    }
    return stdinSize;
}
export function getContextPercent(stdin, config) {
    const overrideSize = config ? getEffectiveContextSize(stdin, config) : 0;
    const hasOverride = overrideSize > 0 && overrideSize !== (stdin.context_window?.context_window_size ?? 0);
    // When there is a custom override, always recalculate from tokens
    if (!hasOverride) {
        const native = getNativePercent(stdin);
        if (native !== null) {
            return native;
        }
    }
    // Manual calculation using effective size
    const size = hasOverride ? overrideSize : (stdin.context_window?.context_window_size ?? 0);
    if (size <= 0) {
        return 0;
    }
    const totalTokens = getTotalTokens(stdin);
    return Math.min(100, Math.round((totalTokens / size) * 100));
}
export function getBufferedPercent(stdin, config) {
    const overrideSize = config ? getEffectiveContextSize(stdin, config) : 0;
    const hasOverride = overrideSize > 0 && overrideSize !== (stdin.context_window?.context_window_size ?? 0);
    // When there is a custom override, always recalculate from tokens
    if (!hasOverride) {
        const native = getNativePercent(stdin);
        if (native !== null) {
            return native;
        }
    }
    // Manual calculation with buffer using effective size
    const size = hasOverride ? overrideSize : (stdin.context_window?.context_window_size ?? 0);
    if (size <= 0) {
        return 0;
    }
    const totalTokens = getTotalTokens(stdin);
    // Scale buffer by raw usage: no buffer at ≤5% (e.g. after /clear),
    // full buffer at ≥50%. Autocompact doesn't kick in at very low usage.
    const rawRatio = totalTokens / size;
    const LOW = 0.05;
    const HIGH = 0.50;
    const scale = Math.min(1, Math.max(0, (rawRatio - LOW) / (HIGH - LOW)));
    const buffer = size * AUTOCOMPACT_BUFFER_PERCENT * scale;
    return Math.min(100, Math.round(((totalTokens + buffer) / size) * 100));
}
export function getModelName(stdin) {
    const displayName = stdin.model?.display_name?.trim();
    if (displayName) {
        return displayName;
    }
    const modelId = stdin.model?.id?.trim();
    if (!modelId) {
        return 'Unknown';
    }
    const normalizedBedrockLabel = normalizeBedrockModelLabel(modelId);
    return normalizedBedrockLabel ?? modelId;
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
function normalizeBedrockModelLabel(modelId) {
    if (!isBedrockModelId(modelId)) {
        return null;
    }
    const lowercaseId = modelId.toLowerCase();
    const claudePrefix = 'anthropic.claude-';
    const claudeIndex = lowercaseId.indexOf(claudePrefix);
    if (claudeIndex === -1) {
        return null;
    }
    let suffix = lowercaseId.slice(claudeIndex + claudePrefix.length);
    suffix = suffix.replace(/-v\d+:\d+$/, '');
    suffix = suffix.replace(/-\d{8}$/, '');
    const tokens = suffix.split('-').filter(Boolean);
    if (tokens.length === 0) {
        return null;
    }
    const familyIndex = tokens.findIndex((token) => token === 'haiku' || token === 'sonnet' || token === 'opus');
    if (familyIndex === -1) {
        return null;
    }
    const family = tokens[familyIndex];
    const beforeVersion = readNumericVersion(tokens, familyIndex - 1, -1).reverse();
    const afterVersion = readNumericVersion(tokens, familyIndex + 1, 1);
    const versionParts = beforeVersion.length >= afterVersion.length ? beforeVersion : afterVersion;
    const version = versionParts.length ? versionParts.join('.') : null;
    const familyLabel = family[0].toUpperCase() + family.slice(1);
    return version ? `Claude ${familyLabel} ${version}` : `Claude ${familyLabel}`;
}
function readNumericVersion(tokens, startIndex, step) {
    const parts = [];
    for (let i = startIndex; i >= 0 && i < tokens.length; i += step) {
        if (!/^\d+$/.test(tokens[i])) {
            break;
        }
        parts.push(tokens[i]);
        if (parts.length === 2) {
            break;
        }
    }
    return parts;
}
//# sourceMappingURL=stdin.js.map