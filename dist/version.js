import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { getHudPluginDir } from './claude-config-dir.js';
import { createDebug } from './debug.js';
const debug = createDebug('version');
const CACHE_FILENAME = '.claude-code-version-cache.json';
const defaultExecFile = promisify(execFile);
let execFileImpl = defaultExecFile;
let resolveClaudeBinaryImpl = resolveClaudeBinaryFromPath;
let platformImpl = () => process.platform;
let windowsCmdImpl = () => 'C:\\Windows\\System32\\cmd.exe';
let cachedBinaryKey;
let cachedVersion;
let hasResolved = false;
function getVersionCachePath(homeDir) {
    return path.join(getHudPluginDir(homeDir), CACHE_FILENAME);
}
function getBinaryCacheKey(binaryInfo) {
    return `${binaryInfo.path}:${binaryInfo.mtimeMs}`;
}
function quoteForCmd(arg) {
    if (!arg) {
        return '""';
    }
    if (!/[\s"&|<>^()]/.test(arg)) {
        return arg;
    }
    return `"${arg.replace(/"/g, '""')}"`;
}
function statResolvedBinary(binaryPath) {
    try {
        const realPath = fs.realpathSync(binaryPath);
        const stat = fs.statSync(realPath);
        if (!stat.isFile()) {
            return null;
        }
        return {
            path: realPath,
            mtimeMs: stat.mtimeMs,
        };
    }
    catch (err) {
        debug('Failed to stat binary %s:', binaryPath, err instanceof Error ? err.message : err);
        return null;
    }
}
function readVersionCache(homeDir) {
    try {
        const cachePath = getVersionCachePath(homeDir);
        if (!fs.existsSync(cachePath)) {
            return null;
        }
        const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        if ((parsed.resolvedFromPath !== undefined && typeof parsed.resolvedFromPath !== 'string')
            ||
                typeof parsed.binaryPath !== 'string'
            || typeof parsed.binaryMtimeMs !== 'number'
            || (typeof parsed.version !== 'string' && parsed.version !== null)) {
            return null;
        }
        return parsed;
    }
    catch (err) {
        debug('Failed to read version cache:', err instanceof Error ? err.message : err);
        return null;
    }
}
function writeVersionCache(homeDir, cache) {
    try {
        const cachePath = getVersionCachePath(homeDir);
        const cacheDir = path.dirname(cachePath);
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
        }
        try {
            fs.chmodSync(cacheDir, 0o700);
        }
        catch {
            // Best-effort: some filesystems do not support POSIX modes.
        }
        fs.writeFileSync(cachePath, JSON.stringify(cache), { encoding: 'utf8', mode: 0o600 });
        try {
            fs.chmodSync(cachePath, 0o600);
        }
        catch {
            // Best-effort: version cache permissions should not affect rendering.
        }
    }
    catch (err) {
        debug('Failed to write version cache:', err instanceof Error ? err.message : err);
    }
}
function isExecutableFile(candidatePath) {
    try {
        const stat = fs.statSync(candidatePath);
        if (!stat.isFile()) {
            return false;
        }
        if (process.platform === 'win32') {
            return true;
        }
        fs.accessSync(candidatePath, fs.constants.X_OK);
        return true;
    }
    catch (err) {
        debug('Binary candidate not executable %s:', candidatePath, err instanceof Error ? err.message : err);
        return false;
    }
}
function getPathCandidates(command) {
    if (process.platform !== 'win32') {
        return [command];
    }
    const ext = path.extname(command);
    if (ext) {
        return [command];
    }
    const pathExt = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
        .split(';')
        .map((value) => value.trim())
        .filter(Boolean);
    return [command, ...pathExt.map((suffix) => `${command}${suffix.toLowerCase()}`), ...pathExt.map((suffix) => `${command}${suffix.toUpperCase()}`)];
}
function resolveClaudeBinaryFromPath() {
    const pathValue = process.env.PATH;
    if (!pathValue) {
        return null;
    }
    const candidates = getPathCandidates('claude');
    for (const entry of pathValue.split(path.delimiter)) {
        if (!entry) {
            continue;
        }
        const dir = entry.replace(/^"(.*)"$/, '$1');
        for (const candidate of candidates) {
            const candidatePath = path.join(dir, candidate);
            if (!isExecutableFile(candidatePath)) {
                continue;
            }
            const binaryInfo = statResolvedBinary(candidatePath);
            if (binaryInfo) {
                return binaryInfo;
            }
        }
    }
    return null;
}
export function _parseClaudeCodeVersion(output) {
    const trimmed = output.trim();
    if (!trimmed) {
        return undefined;
    }
    const match = trimmed.match(/\d+(?:\.\d+)+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?/);
    return match?.[0];
}
export function _getClaudeVersionInvocation(binaryPath, platform = platformImpl(), windowsCmd = windowsCmdImpl()) {
    const ext = path.extname(binaryPath).toLowerCase();
    if (platform === 'win32' && (ext === '.cmd' || ext === '.bat')) {
        const command = [quoteForCmd(binaryPath), '--version'].join(' ');
        return {
            file: windowsCmd,
            args: ['/d', '/s', '/c', `"${command}"`],
        };
    }
    return {
        file: binaryPath,
        args: ['--version'],
    };
}
// The running session's version; getClaudeCodeVersion() is the fallback when stdin omits it.
export function resolveStdinClaudeCodeVersion(value) {
    if (typeof value !== 'string') {
        return undefined;
    }
    return _parseClaudeCodeVersion(value);
}
export async function getClaudeCodeVersion() {
    const homeDir = os.homedir();
    const diskCache = readVersionCache(homeDir);
    if (diskCache) {
        const cachedBinaryInfo = statResolvedBinary(diskCache.binaryPath);
        const resolvedBinaryCandidate = resolveClaudeBinaryImpl();
        const currentResolvedBinary = resolvedBinaryCandidate
            ? (statResolvedBinary(resolvedBinaryCandidate.path) ?? resolvedBinaryCandidate)
            : null;
        if (cachedBinaryInfo
            && cachedBinaryInfo.path === diskCache.binaryPath
            && cachedBinaryInfo.mtimeMs === diskCache.binaryMtimeMs
            && currentResolvedBinary
            && currentResolvedBinary.path === diskCache.binaryPath) {
            const cachedKey = getBinaryCacheKey(cachedBinaryInfo);
            if (hasResolved && cachedBinaryKey === cachedKey) {
                return cachedVersion;
            }
            cachedBinaryKey = cachedKey;
            cachedVersion = diskCache.version ?? undefined;
            hasResolved = true;
            return cachedVersion;
        }
    }
    const resolvedBinaryInfo = resolveClaudeBinaryImpl();
    if (!resolvedBinaryInfo) {
        return undefined;
    }
    // Normalize resolver output to the actual on-disk binary so cache keys and
    // persisted mtimes stay stable across process boundaries.
    const binaryInfo = statResolvedBinary(resolvedBinaryInfo.path) ?? resolvedBinaryInfo;
    const binaryKey = getBinaryCacheKey(binaryInfo);
    if (hasResolved && cachedBinaryKey === binaryKey) {
        return cachedVersion;
    }
    try {
        const invocation = _getClaudeVersionInvocation(binaryInfo.path);
        const { stdout } = await execFileImpl(invocation.file, invocation.args, {
            timeout: 2000,
            encoding: 'utf8',
            windowsHide: true,
        });
        cachedVersion = _parseClaudeCodeVersion(stdout);
    }
    catch (err) {
        debug('Failed to execute claude --version:', err instanceof Error ? err.message : err);
        cachedVersion = undefined;
    }
    writeVersionCache(homeDir, {
        resolvedFromPath: resolvedBinaryInfo.path,
        binaryPath: binaryInfo.path,
        binaryMtimeMs: binaryInfo.mtimeMs,
        version: cachedVersion ?? null,
    });
    cachedBinaryKey = binaryKey;
    hasResolved = true;
    return cachedVersion;
}
export function _resetVersionCache() {
    cachedBinaryKey = undefined;
    cachedVersion = undefined;
    hasResolved = false;
}
export function _setExecFileImplForTests(impl) {
    execFileImpl = impl ?? defaultExecFile;
}
export function _setResolveClaudeBinaryForTests(impl) {
    resolveClaudeBinaryImpl = impl ?? resolveClaudeBinaryFromPath;
}
export function _setVersionInvocationEnvForTests(platformGetter, windowsCmdGetter) {
    platformImpl = platformGetter ?? (() => process.platform);
    windowsCmdImpl = windowsCmdGetter ?? (() => 'C:\\Windows\\System32\\cmd.exe');
}
//# sourceMappingURL=version.js.map