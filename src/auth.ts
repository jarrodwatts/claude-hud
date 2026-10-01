import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getClaudeConfigJsonPath, getHudPluginDir } from './claude-config-dir.js';
import { sanitizeDisplayText } from './utils/sanitize.js';

/**
 * Authentication info for the current Claude Code login, derived from the
 * `oauthAccount` block Claude Code persists in ~/.claude.json, or
 * $CLAUDE_CONFIG_DIR/.claude.json when the config directory is overridden.
 *
 *   method: human-readable auth/plan label (e.g. "Claude Max 20x", "API Key")
 *   user:   account identifier (email local part, falling back to displayName)
 */
export interface AuthInfo {
  method: string | null;
  user: string | null;
}

const EMPTY_AUTH_INFO: AuthInfo = { method: null, user: null };
const API_KEY_AUTH_INFO: AuthInfo = { method: 'API Key', user: null };
const AUTH_VALUE_MAX_LEN = 128;

function hasApiKey(env: NodeJS.ProcessEnv): boolean {
  return typeof env.ANTHROPIC_API_KEY === 'string' && env.ANTHROPIC_API_KEY.trim().length > 0;
}

// Strip ANSI sequences and control/bidi characters so values from
// claude.json can never smuggle escape sequences into the terminal.
function sanitizeValue(value: string): string {
  return sanitizeDisplayText(value).trim().slice(0, AUTH_VALUE_MAX_LEN);
}

function readString(obj: Record<string, unknown>, key: string): string | null {
  const value = obj[key];
  if (typeof value !== 'string') {
    return null;
  }
  const sanitized = sanitizeValue(value);
  return sanitized.length > 0 ? sanitized : null;
}

/**
 * Formats an organizationType value into a display label:
 * "claude_max" → "Claude Max", "claude_pro" → "Claude Pro".
 */
function formatOrgType(orgType: string): string {
  return orgType
    .split('_')
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Extracts a multiplier suffix from a rate-limit tier value:
 * "default_claude_max_20x" → "20x". Returns null when no tier is encoded.
 */
function extractTierSuffix(rateLimitTier: string): string | null {
  const match = /_(\d+x)$/i.exec(rateLimitTier);
  return match ? match[1] : null;
}

/**
 * Derives auth info from the parsed contents of claude.json.
 * Pure so it can be tested without touching the filesystem.
 */
export function deriveAuthInfo(claudeJson: unknown, env: NodeJS.ProcessEnv = process.env): AuthInfo {
  // ANTHROPIC_API_KEY takes precedence at runtime. oauthAccount can remain in
  // claude.json after a user switches to API-key authentication.
  if (hasApiKey(env)) {
    return API_KEY_AUTH_INFO;
  }

  const root = (claudeJson && typeof claudeJson === 'object')
    ? claudeJson as Record<string, unknown>
    : null;
  const account = (root?.oauthAccount && typeof root.oauthAccount === 'object')
    ? root.oauthAccount as Record<string, unknown>
    : null;

  if (!account) {
    return EMPTY_AUTH_INFO;
  }

  let method: string | null = null;
  const orgType = readString(account, 'organizationType');
  if (orgType) {
    method = formatOrgType(orgType);
    const rateLimitTier = readString(account, 'organizationRateLimitTier');
    const tier = rateLimitTier ? extractTierSuffix(rateLimitTier) : null;
    if (tier && !method.toLowerCase().includes(tier.toLowerCase())) {
      method += ` ${tier}`;
    }
  }

  const email = readString(account, 'emailAddress');
  const user = email ? email.split('@')[0] : readString(account, 'displayName');

  return { method, user };
}

/**
 * Cache of the two DERIVED fields, keyed on the source file's identity.
 *
 * The identity combines mtime, ctime, size, device, and inode so a replacement
 * or rapid rewrite cannot reuse a stale entry based on one timestamp alone.
 */
interface AuthCacheEntry {
  version: number;
  mtimeMs: number;
  ctimeMs: number;
  size: number;
  dev: number;
  ino: number;
  method: string | null;
  user: string | null;
}

function authCachePath(homeDir: string): string {
  return path.join(getHudPluginDir(homeDir), AUTH_CACHE_DIRNAME, 'auth.json');
}

const AUTH_CACHE_DIRNAME = 'auth-cache';
const AUTH_CACHE_VERSION = 1;
const AUTH_CACHE_MAX_BYTES = 4096;

function normalizeCachedValue(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length === 0 || value.length > AUTH_VALUE_MAX_LEN) {
    return undefined;
  }
  return sanitizeValue(value) === value ? value : undefined;
}

function readAuthCache(homeDir: string): AuthCacheEntry | null {
  let fd: number | undefined;
  try {
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
    fd = fs.openSync(authCachePath(homeDir), flags);
    const cacheStat = fs.fstatSync(fd);
    if (!cacheStat.isFile() || cacheStat.size <= 0 || cacheStat.size > AUTH_CACHE_MAX_BYTES) {
      return null;
    }

    const parsed: unknown = JSON.parse(fs.readFileSync(fd, 'utf-8'));
    const method = parsed && typeof parsed === 'object'
      ? normalizeCachedValue((parsed as Record<string, unknown>).method)
      : undefined;
    const user = parsed && typeof parsed === 'object'
      ? normalizeCachedValue((parsed as Record<string, unknown>).user)
      : undefined;
    if (
      parsed == null || typeof parsed !== 'object'
      || (parsed as AuthCacheEntry).version !== AUTH_CACHE_VERSION
      || typeof (parsed as AuthCacheEntry).mtimeMs !== 'number'
      || typeof (parsed as AuthCacheEntry).ctimeMs !== 'number'
      || typeof (parsed as AuthCacheEntry).size !== 'number'
      || typeof (parsed as AuthCacheEntry).dev !== 'number'
      || typeof (parsed as AuthCacheEntry).ino !== 'number'
      || method === undefined
      || user === undefined
    ) {
      return null;
    }
    return { ...(parsed as AuthCacheEntry), method, user };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* best effort */ }
    }
  }
}

function writeAuthCache(homeDir: string, entry: AuthCacheEntry): void {
  let tmpPath: string | undefined;
  let fd: number | undefined;
  try {
    const cachePath = authCachePath(homeDir);
    const cacheDir = path.dirname(cachePath);
    fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
    const dirStat = fs.lstatSync(cacheDir);
    if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) return;
    try { fs.chmodSync(cacheDir, 0o700); } catch { /* best effort */ }

    // Write-then-rename: the status line can run concurrently across sessions,
    // and a torn read would just miss the cache, but a torn WRITE would persist.
    tmpPath = `${cachePath}.${process.pid}.${randomUUID()}.tmp`;
    fd = fs.openSync(tmpPath, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify(entry), 'utf-8');
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmpPath, cachePath);
    tmpPath = undefined;
    try { fs.chmodSync(cachePath, 0o600); } catch { /* best effort */ }
  } catch {
    // A cache write must never break the status line.
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* best effort */ }
    }
    if (tmpPath) {
      try { fs.unlinkSync(tmpPath); } catch { /* best effort */ }
    }
  }
}

/**
 * Reads auth info for the current login. Never throws.
 *
 * claude.json is the user's entire CLI config and grows with project history —
 * 73 KB on the host this was measured on. The status line runs on every
 * interaction, so parsing it per tick is not free. The two derived fields are
 * cached against the file's (mtimeMs, ctimeMs, size, dev, ino) identity instead,
 * making the steady-state cost a stat plus a ~100-byte read.
 */
export function readAuthInfo(): AuthInfo {
  // Avoid reading a stale OAuth profile when the active source is an API key.
  if (hasApiKey(process.env)) {
    return API_KEY_AUTH_INFO;
  }

  const homeDir = os.homedir();
  const configJsonPath = getClaudeConfigJsonPath(homeDir);

  let stat: fs.Stats;
  try {
    stat = fs.statSync(configJsonPath);
  } catch {
    return EMPTY_AUTH_INFO;
  }

  const cached = readAuthCache(homeDir);
  if (
    cached
    && cached.mtimeMs === stat.mtimeMs
    && cached.ctimeMs === stat.ctimeMs
    && cached.size === stat.size
    && cached.dev === stat.dev
    && cached.ino === stat.ino
  ) {
    return { method: cached.method, user: cached.user };
  }

  try {
    const content = fs.readFileSync(configJsonPath, 'utf-8');
    const info = deriveAuthInfo(JSON.parse(content));
    writeAuthCache(homeDir, {
      version: AUTH_CACHE_VERSION,
      mtimeMs: stat.mtimeMs,
      ctimeMs: stat.ctimeMs,
      size: stat.size,
      dev: stat.dev,
      ino: stat.ino,
      method: info.method,
      user: info.user,
    });
    return info;
  } catch {
    return EMPTY_AUTH_INFO;
  }
}

export function truncateUser(user: string, maxLength: number): string {
  if (maxLength <= 0 || user.length <= maxLength) {
    return user;
  }
  return `${user.slice(0, maxLength)}…`;
}

/**
 * Builds the standalone auth segment for the end of the first HUD line,
 * honoring the showAuth / showAuthUser / authUserLength display settings.
 * Returns e.g. "Claude Max 20x · yukinosh…", or null when nothing to show.
 */
export function formatAuthSegment(
  info: AuthInfo | null | undefined,
  display: { showAuth?: boolean; showAuthUser?: boolean; authUserLength?: number } | undefined,
): string | null {
  if (!info) {
    return null;
  }

  const parts: string[] = [];
  if (display?.showAuth && info.method) {
    parts.push(info.method);
  }
  if (display?.showAuthUser && info.user) {
    parts.push(truncateUser(info.user, display?.authUserLength ?? 8));
  }

  return parts.length > 0 ? parts.join(' · ') : null;
}
