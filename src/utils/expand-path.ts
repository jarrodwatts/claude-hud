import * as os from 'node:os';

// Matches ${VAR} and $VAR (POSIX-style), and %VAR% (Windows-style).
// VAR names are restricted to the common shell-safe charset so stray `$`/`%`
// in an unrelated path (e.g. a literal filename) pass through untouched.
const BRACED_VAR = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
const BARE_VAR = /\$([A-Za-z_][A-Za-z0-9_]*)/g;
const WINDOWS_VAR = /%([A-Za-z_][A-Za-z0-9_]*)%/g;

/**
 * Expands a leading `~`, `${VAR}`/`$VAR`, and `%VAR%` references against the
 * current environment and home directory, for user-supplied config paths
 * (externalUsagePath / externalUsageWritePath) so a config.json can stay
 * portable across machines and usernames. Unresolved variables are left as-is
 * rather than collapsed to an empty string, so a typo'd name fails the
 * downstream absolute-path check instead of silently pointing somewhere
 * unintended.
 */
export function expandPath(value: string): string {
  if (!value) {
    return value;
  }

  let expanded = value;

  if (expanded === '~' || expanded.startsWith('~/') || expanded.startsWith('~\\')) {
    expanded = os.homedir() + expanded.slice(1);
  }

  const expandVar = (name: string, whole: string): string => {
    const replacement = process.env[name];
    return replacement !== undefined ? replacement : whole;
  };

  expanded = expanded.replace(BRACED_VAR, (whole, name) => expandVar(name, whole));
  expanded = expanded.replace(BARE_VAR, (whole, name) => expandVar(name, whole));
  expanded = expanded.replace(WINDOWS_VAR, (whole, name) => expandVar(name, whole));

  return expanded;
}
