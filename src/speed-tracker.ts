import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash } from 'node:crypto';
import type { StdinData } from './types.js';
import { getHudPluginDir } from './claude-config-dir.js';
import { createDebug } from './debug.js';

const debug = createDebug('speed-tracker');

const SPEED_WINDOW_MS = 2000;
// Status lines can re-render many times per second while tokens stream.
// Computing a rate from sub-500ms windows amplifies noise and produces
// spurious multi-thousand tok/s readings (see #481). Require at least
// half a second of elapsed time before reporting a speed.
const MIN_DELTA_MS = 500;

const CACHE_DIRNAME = 'speed-cache';
const LEGACY_CACHE_FILENAME = '.speed-cache.json';
// Fallback: approximate bytes-per-token ratio for transcript file growth estimation.
// Claude's JSONL transcript is mostly ASCII with some overhead; ~4 bytes/token is a
// reasonable ballpark that avoids wild over/under-estimates.
const BYTES_PER_TOKEN = 4;

interface SpeedCache {
  outputTokens: number;
  timestamp: number;
}

interface FileSizeCache {
  fileSize: number;
  timestamp: number;
}

interface ResponseSpeedCache {
  apiDurationMs: number;
  usageKey: string;
  speed: number | null;
}

type CurrentUsage = NonNullable<NonNullable<StdinData['context_window']>['current_usage']>;

export type SpeedTrackerDeps = {
  homeDir: () => string;
  now: () => number;
};

const defaultDeps: SpeedTrackerDeps = {
  homeDir: () => os.homedir(),
  now: () => Date.now(),
};

// Scope the cache by a sha256 of the resolved transcript path so that
// concurrent Claude Code sessions never share or overwrite each other's
// cached output-token counters. Sharing the cache across sessions
// produced bogus speed readings on idle terminals whenever another
// terminal was actively streaming (see #495).
function getCachePath(homeDir: string, transcriptPath: string): string {
  const hash = createHash('sha256').update(path.resolve(transcriptPath)).digest('hex');
  return path.join(getHudPluginDir(homeDir), CACHE_DIRNAME, `${hash}.json`);
}

function readCache(homeDir: string, transcriptPath: string): SpeedCache | null {
  try {
    const cachePath = getCachePath(homeDir, transcriptPath);
    if (!fs.existsSync(cachePath)) return null;
    const content = fs.readFileSync(cachePath, 'utf8');
    const parsed = JSON.parse(content) as SpeedCache;
    if (typeof parsed.outputTokens !== 'number' || typeof parsed.timestamp !== 'number') {
      return null;
    }
    return parsed;
  } catch (err) {
    debug('Failed to read speed cache:', err instanceof Error ? err.message : err);
    return null;
  }
}

function ensurePrivateDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // Best-effort: some filesystems do not support POSIX modes.
  }
}

function writeCache(homeDir: string, transcriptPath: string, cache: SpeedCache): void {
  try {
    const cachePath = getCachePath(homeDir, transcriptPath);
    const cacheDir = path.dirname(cachePath);
    ensurePrivateDir(cacheDir);
    fs.writeFileSync(cachePath, JSON.stringify(cache), { encoding: 'utf8', mode: 0o600 });
    try {
      fs.chmodSync(cachePath, 0o600);
    } catch {
      // Best-effort: cache permissions should not break speed tracking.
    }
  } catch (err) {
    debug('Failed to write speed cache:', err instanceof Error ? err.message : err);
  }
}

function readFileSizeCache(cachePath: string): FileSizeCache | null {
  try {
    if (!fs.existsSync(cachePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as FileSizeCache;
    if (
      typeof parsed.fileSize !== 'number'
      || !Number.isFinite(parsed.fileSize)
      || typeof parsed.timestamp !== 'number'
      || !Number.isFinite(parsed.timestamp)
    ) {
      return null;
    }
    return parsed;
  } catch (err) {
    debug('Failed to read file size cache:', err instanceof Error ? err.message : err);
    return null;
  }
}

function readResponseSpeedCache(cachePath: string): ResponseSpeedCache | null {
  try {
    if (!fs.existsSync(cachePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as ResponseSpeedCache;
    if (
      typeof parsed.apiDurationMs !== 'number'
      || !Number.isFinite(parsed.apiDurationMs)
      || typeof parsed.usageKey !== 'string'
      || (parsed.speed !== null && (typeof parsed.speed !== 'number' || !Number.isFinite(parsed.speed)))
    ) {
      return null;
    }
    return parsed;
  } catch (err) {
    debug('Failed to read response speed cache:', err instanceof Error ? err.message : err);
    return null;
  }
}

function writeJsonCache(cachePath: string, cache: FileSizeCache | ResponseSpeedCache): void {
  try {
    const cacheDir = path.dirname(cachePath);
    ensurePrivateDir(cacheDir);
    fs.writeFileSync(cachePath, JSON.stringify(cache), { encoding: 'utf8', mode: 0o600 });
    try {
      fs.chmodSync(cachePath, 0o600);
    } catch {
      // Best-effort: cache permissions should not break speed tracking.
    }
  } catch (err) {
    debug('Failed to write speed cache file:', err instanceof Error ? err.message : err);
  }
}

// Remove the pre-0.x global cache file once, if present. It has no owner
// session so leaving it around only wastes disk.
function removeLegacyCache(homeDir: string): void {
  try {
    const legacyPath = path.join(getHudPluginDir(homeDir), LEGACY_CACHE_FILENAME);
    if (fs.existsSync(legacyPath)) {
      fs.unlinkSync(legacyPath);
    }
  } catch (err) {
    debug('Failed to remove legacy cache:', err instanceof Error ? err.message : err);
  }
}

/**
 * Fallback speed estimation when output_tokens is unavailable.
 *
 * Measures the transcript file's byte-size growth between successive
 * render calls and converts the delta to an approximate token/s rate
 * using the BYTES_PER_TOKEN heuristic. This allows the HUD to show a
 * speed reading even when the model provider (e.g. a non-standard
 * proxy) does not populate `context_window.current_usage.output_tokens`.
 */
function getTranscriptSpeed(
  transcriptPath: string,
  homeDir: string,
  now: number,
): number | null {
  try {
    const stat = fs.statSync(transcriptPath);
    if (!stat.isFile()) return null;

    const canonicalTranscriptPath = fs.realpathSync(transcriptPath);
    const fileSize = stat.size;
    const cachePath = getCachePath(homeDir, canonicalTranscriptPath) + '.fs';
    const prev = readFileSizeCache(cachePath);

    if (!prev) {
      writeJsonCache(cachePath, { fileSize, timestamp: now });
      return null;
    }

    const deltaBytes = fileSize - prev.fileSize;
    const deltaMs = now - prev.timestamp;

    if (deltaMs > SPEED_WINDOW_MS || deltaMs < MIN_DELTA_MS || deltaBytes <= 0) {
      if (deltaMs >= MIN_DELTA_MS) {
        writeJsonCache(cachePath, { fileSize, timestamp: now });
      }
      return null;
    }

    const estimatedTokens = deltaBytes / BYTES_PER_TOKEN;
    writeJsonCache(cachePath, { fileSize, timestamp: now });
    return estimatedTokens / (deltaMs / 1000);
  } catch (err) {
    debug('Failed to compute transcript speed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * `current_usage.output_tokens` only updates once a response finishes, and
 * `cost.total_api_duration_ms` advances by that response's request time in the
 * same update, so speed is output tokens over the API time added since then.
 */
function getResponseSpeed(
  transcriptPath: string,
  homeDir: string,
  usage: CurrentUsage,
  outputTokens: number,
  apiDurationMs: number,
): number | null {
  const cachePath = getCachePath(homeDir, transcriptPath) + '.api';
  const usageKey = [
    usage.input_tokens,
    outputTokens,
    usage.cache_creation_input_tokens,
    usage.cache_read_input_tokens,
  ].join(':');
  const previous = readResponseSpeedCache(cachePath);

  if (!previous || apiDurationMs < previous.apiDurationMs) {
    writeJsonCache(cachePath, { apiDurationMs, usageKey, speed: null });
    return null;
  }

  if (apiDurationMs === previous.apiDurationMs) {
    return previous.speed;
  }

  // API time also advances for requests that leave the main conversation's
  // usage untouched (subagents, background calls). Fold that time into the
  // baseline instead of charging it to the next response.
  const deltaMs = apiDurationMs - previous.apiDurationMs;
  const isNewResponse = usageKey !== previous.usageKey && outputTokens > 0;
  const speed = isNewResponse && deltaMs >= MIN_DELTA_MS
    ? outputTokens / (deltaMs / 1000)
    : previous.speed;
  writeJsonCache(cachePath, { apiDurationMs, usageKey, speed });
  return speed;
}

export function getOutputSpeed(stdin: StdinData, overrides: Partial<SpeedTrackerDeps> = {}): number | null {
  const transcriptPath = stdin.transcript_path?.trim();
  if (!transcriptPath) {
    // Without a stable session key we cannot safely isolate cache entries
    // across concurrent Claude Code sessions, so skip speed tracking.
    return null;
  }

  const deps = { ...defaultDeps, ...overrides };
  const now = deps.now();
  const homeDir = deps.homeDir();

  removeLegacyCache(homeDir);

  // Primary: use output_tokens when the provider supplies it.
  const usage = stdin.context_window?.current_usage;
  const outputTokens = usage?.output_tokens;
  if (usage && typeof outputTokens === 'number' && Number.isFinite(outputTokens)) {
    const apiDurationMs = stdin.cost?.total_api_duration_ms;
    if (typeof apiDurationMs === 'number' && Number.isFinite(apiDurationMs)) {
      return getResponseSpeed(transcriptPath, homeDir, usage, outputTokens, apiDurationMs);
    }

    // Without `cost` there is no API time to divide by, so diff
    // output_tokens across renders instead.
    const previous = readCache(homeDir, transcriptPath);

    if (!previous) {
      writeCache(homeDir, transcriptPath, { outputTokens, timestamp: now });
      return null;
    }

    if (outputTokens < previous.outputTokens) {
      writeCache(homeDir, transcriptPath, { outputTokens, timestamp: now });
      return null;
    }

    const deltaTokens = outputTokens - previous.outputTokens;
    const deltaMs = now - previous.timestamp;

    if (deltaMs > SPEED_WINDOW_MS) {
      writeCache(homeDir, transcriptPath, { outputTokens, timestamp: now });
      return null;
    }

    if (deltaTokens <= 0) {
      writeCache(homeDir, transcriptPath, { outputTokens, timestamp: now });
      return null;
    }

    if (deltaMs < MIN_DELTA_MS) {
      return null;
    }

    const speed = deltaTokens / (deltaMs / 1000);
    writeCache(homeDir, transcriptPath, { outputTokens, timestamp: now });
    return speed;
  }

  // Fallback: estimate from transcript file byte-size growth when the
  // provider does not expose output_tokens (e.g. non-standard proxies).
  return getTranscriptSpeed(transcriptPath, homeDir, now);
}
