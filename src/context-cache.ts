import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { getHudPluginDir } from "./claude-config-dir.js";
import type { StdinData } from "./types.js";

const CACHE_DIRNAME = "context-cache";

/**
 * Minimum interval between cache rewrites for the same session.
 * Status line runs every ~300ms so this keeps the steady-state write path cheap
 * while still refreshing the fallback snapshot regularly.
 */
const WRITE_TTL_MS = 3_000;

/**
 * Sweep parameters bounding long-term growth of the cache directory.
 * A sweep is attempted probabilistically on cache writes to avoid paying
 * directory-scan cost on every status line tick.
 */
const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 100;
const SWEEP_SAMPLE_RATE = 0.01;

type CurrentUsage = NonNullable<
  NonNullable<StdinData["context_window"]>["current_usage"]
>;
type ContextWindow = NonNullable<StdinData["context_window"]>;

type ContextCache = {
  used_percentage: number;
  remaining_percentage?: number | null;
  current_usage?: CurrentUsage | null;
  context_window_size?: number | null;
  saved_at?: number;
  session_name?: string | null;
};

export type ContextCacheDeps = {
  homeDir: () => string;
  now: () => number;
  random: () => number;
};

const defaultDeps: ContextCacheDeps = {
  homeDir: () => os.homedir(),
  now: () => Date.now(),
  random: () => Math.random(),
};

/**
 * Resolve the session-scoped cache file used for context window fallback.
 * Uses a sha256 of the transcript path so that concurrent Claude Code
 * sessions never share or overwrite each other's cached snapshots.
 */
function getCachePath(homeDir: string, transcriptPath: string): string {
  const hash = createHash("sha256")
    .update(path.resolve(transcriptPath))
    .digest("hex");
  return path.join(getHudPluginDir(homeDir), CACHE_DIRNAME, `${hash}.json`);
}

/**
 * Resolve the cache directory that holds all session-scoped snapshots.
 */
function getCacheDir(homeDir: string): string {
  return path.join(getHudPluginDir(homeDir), CACHE_DIRNAME);
}

/**
 * Read the last known good context snapshot from disk.
 * Returns null when the cache is missing, malformed, or invalid.
 */
function readCache(
  homeDir: string,
  transcriptPath: string
): ContextCache | null {
  try {
    const cachePath = getCachePath(homeDir, transcriptPath);
    if (!fs.existsSync(cachePath)) return null;
    const content = fs.readFileSync(cachePath, "utf8");
    const parsed = JSON.parse(content) as ContextCache;
    if (
      typeof parsed.used_percentage !== "number" ||
      !Number.isFinite(parsed.used_percentage)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Decide whether the current write can be skipped because the cached snapshot
 * for this session was refreshed recently enough.
 */
function shouldSkipWrite(
  cachePath: string,
  now: number
): boolean {
  try {
    const stat = fs.statSync(cachePath);
    return now - stat.mtimeMs < WRITE_TTL_MS;
  } catch {
    return false;
  }
}

/**
 * Persist a known-good context snapshot for future fallback use.
 * Any write failure is intentionally ignored to keep rendering non-blocking.
 */
function writeCache(
  homeDir: string,
  transcriptPath: string,
  contextWindow: ContextWindow,
  now: number,
  sessionName?: string
): void {
  try {
    const cachePath = getCachePath(homeDir, transcriptPath);
    if (shouldSkipWrite(cachePath, now)) {
      return;
    }
    const cacheDir = path.dirname(cachePath);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    const payload: ContextCache = {
      used_percentage: contextWindow.used_percentage ?? 0,
      remaining_percentage: contextWindow.remaining_percentage ?? null,
      current_usage: contextWindow.current_usage ?? null,
      context_window_size: contextWindow.context_window_size ?? null,
      saved_at: now,
      session_name: sessionName ?? null,
    };
    fs.writeFileSync(cachePath, JSON.stringify(payload), "utf8");
    const timestampSeconds = now / 1000;
    fs.utimesSync(cachePath, timestampSeconds, timestampSeconds);
  } catch {
    // Ignore cache write failures
  }
}

/**
 * Remove stale cache entries and enforce a hard cap on total file count.
 * Safe to run opportunistically; every per-file failure is swallowed.
 */
function sweepCacheDir(cacheDir: string, now: number): void {
  try {
    if (!fs.existsSync(cacheDir)) return;
    const entries = fs.readdirSync(cacheDir, { withFileTypes: true });
    const survivors: { fullPath: string; mtimeMs: number }[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const fullPath = path.join(cacheDir, entry.name);
      try {
        const stat = fs.statSync(fullPath);
        if (now - stat.mtimeMs > MAX_CACHE_AGE_MS) {
          fs.unlinkSync(fullPath);
          continue;
        }
        survivors.push({ fullPath, mtimeMs: stat.mtimeMs });
      } catch {
        // Ignore per-file failure
      }
    }

    if (survivors.length > MAX_CACHE_ENTRIES) {
      survivors.sort((a, b) => a.mtimeMs - b.mtimeMs);
      const toDelete = survivors.length - MAX_CACHE_ENTRIES;
      for (let i = 0; i < toDelete; i += 1) {
        try {
          fs.unlinkSync(survivors[i].fullPath);
        } catch {
          // Ignore per-file failure
        }
      }
    }
  } catch {
    // Ignore top-level sweep errors
  }
}

/**
 * Check whether all tracked token counters in current_usage are zero.
 */
function isAllUsageZero(usage: ContextWindow["current_usage"]): boolean {
  if (!usage) {
    return true;
  }
  return (
    (usage.input_tokens ?? 0) === 0 &&
    (usage.output_tokens ?? 0) === 0 &&
    (usage.cache_creation_input_tokens ?? 0) === 0 &&
    (usage.cache_read_input_tokens ?? 0) === 0
  );
}

/**
 * Detect the known Claude Code glitch where usage is reported as zero
 * despite a large accumulated input token count.
 */
function isSuspiciousZero(contextWindow: ContextWindow): boolean {
  const contextWindowSize = contextWindow.context_window_size ?? 0;
  const totalInputTokens = contextWindow.total_input_tokens ?? 0;
  if (contextWindowSize <= 0 || totalInputTokens <= contextWindowSize) {
    return false;
  }
  if ((contextWindow.used_percentage ?? 0) !== 0) {
    return false;
  }
  return isAllUsageZero(contextWindow.current_usage);
}

/**
 * Determine whether the current frame contains a usable context snapshot.
 */
function hasGoodContext(contextWindow: ContextWindow): boolean {
  return (
    (contextWindow.context_window_size ?? 0) > 0 &&
    typeof contextWindow.used_percentage === "number" &&
    contextWindow.used_percentage > 0
  );
}

/**
 * Merge cached context fields into the current frame.
 * Prefer the frame's context_window_size when already present.
 */
function applyCachedContext(
  contextWindow: ContextWindow,
  cache: ContextCache
): void {
  contextWindow.used_percentage = cache.used_percentage;
  contextWindow.remaining_percentage = cache.remaining_percentage ?? null;
  contextWindow.current_usage = cache.current_usage ?? null;
  contextWindow.context_window_size =
    contextWindow.context_window_size ?? cache.context_window_size ?? undefined;
}

export type CompactHint = {
  /** Timestamp of the most recent compact_boundary entry in the transcript. */
  lastCompactBoundaryAt?: Date;
  /** Post-compact token count from compactMetadata, when Claude Code records it. */
  lastCompactPostTokens?: number;
};

/**
 * Apply context-window fallback in-place:
 * - For suspicious zero frames, try restoring from the session-scoped cache.
 * - For healthy frames, refresh the cache snapshot for this session
 *   (subject to TTL + value-change throttling to avoid hot-path writes).
 *
 * When `compactHint.lastCompactBoundaryAt` is newer than the cached snapshot's
 * `saved_at`, the zero frame is treated as a legitimate post-/compact reset and
 * the stale pre-compact snapshot is NOT restored. If `lastCompactPostTokens`
 * is provided, it is used to synthesize an accurate transition-window percent.
 *
 * No-op when stdin has no transcript_path, since without a stable session key
 * we cannot safely isolate cache entries across concurrent Claude Code sessions.
 */
export function applyContextWindowFallback(
  stdin: StdinData,
  overrides: Partial<ContextCacheDeps> = {},
  sessionName?: string,
  compactHint?: CompactHint
): void {
  const contextWindow = stdin.context_window;
  if (!contextWindow) {
    return;
  }

  const transcriptPath = stdin.transcript_path?.trim();
  if (!transcriptPath) {
    return;
  }

  const deps = { ...defaultDeps, ...overrides };
  const homeDir = deps.homeDir();
  const now = deps.now();

  if (isSuspiciousZero(contextWindow)) {
    const cached = readCache(homeDir, transcriptPath);
    const boundaryMs = compactHint?.lastCompactBoundaryAt?.getTime();
    const isPostCompactReset =
      typeof boundaryMs === "number" &&
      Number.isFinite(boundaryMs) &&
      (!cached?.saved_at || boundaryMs > cached.saved_at);

    if (isPostCompactReset) {
      // Legitimate /compact reset: keep the zero frame instead of restoring a
      // stale pre-compact snapshot. Surface the compactMetadata.postTokens
      // value (when available) so the bar shows the real post-compact
      // percent during the transition before the next assistant response.
      const postTokens = compactHint?.lastCompactPostTokens;
      const size = contextWindow.context_window_size ?? 0;
      if (typeof postTokens === "number" && postTokens > 0 && size > 0) {
        const pct = Math.min(100, Math.max(0, Math.round((postTokens / size) * 100)));
        contextWindow.used_percentage = pct;
        contextWindow.remaining_percentage = 100 - pct;
      }
    } else if (cached) {
      applyCachedContext(contextWindow, cached);
    }
  }

  if (hasGoodContext(contextWindow)) {
    writeCache(homeDir, transcriptPath, contextWindow, now, sessionName);
    if (deps.random() < SWEEP_SAMPLE_RATE) {
      sweepCacheDir(getCacheDir(homeDir), now);
    }
  }
}

/**
 * Test-only entrypoint for deterministically exercising the sweep logic.
 */
export function _sweepCacheForTests(homeDir: string, now: number): void {
  sweepCacheDir(getCacheDir(homeDir), now);
}
