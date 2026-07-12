import * as fs from 'node:fs';
import * as os from 'node:os';
import { getClaudeConfigJsonPath } from './claude-config-dir.js';
import { sanitizeDisplayText } from './utils/sanitize.js';

/**
 * Authentication info for the current Claude Code login, derived from the
 * `oauthAccount` block Claude Code persists in {CLAUDE_CONFIG_DIR}.json.
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

function hasApiKey(env: NodeJS.ProcessEnv): boolean {
  return typeof env.ANTHROPIC_API_KEY === 'string' && env.ANTHROPIC_API_KEY.trim().length > 0;
}

// Strip ANSI sequences and control/bidi characters so values from
// claude.json can never smuggle escape sequences into the terminal.
function sanitizeValue(value: string): string {
  return sanitizeDisplayText(value).trim();
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
 * Derives auth info from the parsed contents of {CLAUDE_CONFIG_DIR}.json.
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

/** Reads auth info for the current login. Never throws. */
export function readAuthInfo(): AuthInfo {
  // Avoid reading a stale OAuth profile when the active source is an API key.
  if (hasApiKey(process.env)) {
    return API_KEY_AUTH_INFO;
  }

  try {
    const configJsonPath = getClaudeConfigJsonPath(os.homedir());
    const content = fs.readFileSync(configJsonPath, 'utf-8');
    return deriveAuthInfo(JSON.parse(content));
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
