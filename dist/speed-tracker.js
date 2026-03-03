import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
const SPEED_WINDOW_MS = 2000;
const defaultDeps = {
    homeDir: () => os.homedir(),
    now: () => Date.now(),
};
function getCachePath(homeDir) {
    return path.join(homeDir, '.claude', 'plugins', 'claude-hud', '.speed-cache.json');
}
function readCache(homeDir) {
    try {
        const cachePath = getCachePath(homeDir);
        if (!fs.existsSync(cachePath))
            return null;
        const content = fs.readFileSync(cachePath, 'utf8');
        const parsed = JSON.parse(content);
        if (typeof parsed.outputTokens !== 'number' || typeof parsed.timestamp !== 'number') {
            return null;
        }
        return parsed;
    }
    catch {
        return null;
    }
}
function writeCache(homeDir, cache) {
    try {
        const cachePath = getCachePath(homeDir);
        const cacheDir = path.dirname(cachePath);
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
        }
        fs.writeFileSync(cachePath, JSON.stringify(cache), 'utf8');
    }
    catch {
        // Ignore cache write failures
    }
}
export function getOutputSpeed(stdin, overrides = {}) {
    const outputTokens = stdin.context_window?.current_usage?.output_tokens;
    if (typeof outputTokens !== 'number' || !Number.isFinite(outputTokens)) {
        return null;
    }
    const deps = { ...defaultDeps, ...overrides };
    const now = deps.now();
    const homeDir = deps.homeDir();
    const previous = readCache(homeDir);
    let speed = null;
    if (previous && outputTokens >= previous.outputTokens) {
        const deltaTokens = outputTokens - previous.outputTokens;
        const deltaMs = now - previous.timestamp;
        if (deltaTokens > 0 && deltaMs > 0 && deltaMs <= SPEED_WINDOW_MS) {
            speed = deltaTokens / (deltaMs / 1000);
        }
    }
    writeCache(homeDir, { outputTokens, timestamp: now });
    return speed;
}
//# sourceMappingURL=speed-tracker.js.map