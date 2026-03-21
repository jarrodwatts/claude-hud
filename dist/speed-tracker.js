import * as os from 'node:os';
import * as path from 'node:path';
import { readCache, writeCache } from './cache.js';
import { getHudPluginDir } from './claude-config-dir.js';
const SPEED_WINDOW_MS = 2000;
const SPEED_CACHE_KEY = 'speed-tracker';
const defaultDeps = {
    homeDir: () => os.homedir(),
    now: () => Date.now(),
};
function getCacheDir(homeDir) {
    return path.join(getHudPluginDir(homeDir), '.cache');
}
export function getOutputSpeed(stdin, overrides = {}) {
    const outputTokens = stdin.context_window?.current_usage?.output_tokens;
    if (typeof outputTokens !== 'number' || !Number.isFinite(outputTokens)) {
        return null;
    }
    const deps = { ...defaultDeps, ...overrides };
    const now = deps.now();
    const cacheDir = getCacheDir(deps.homeDir());
    const previous = readCache(SPEED_CACHE_KEY, 5000, cacheDir);
    let speed = null;
    if (previous && outputTokens >= previous.outputTokens) {
        const deltaTokens = outputTokens - previous.outputTokens;
        const deltaMs = now - previous.timestamp;
        if (deltaTokens > 0 && deltaMs > 0 && deltaMs <= SPEED_WINDOW_MS) {
            speed = deltaTokens / (deltaMs / 1000);
        }
    }
    writeCache(SPEED_CACHE_KEY, { outputTokens, timestamp: now }, cacheDir);
    return speed;
}
//# sourceMappingURL=speed-tracker.js.map