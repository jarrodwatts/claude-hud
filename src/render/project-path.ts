import type { PathLevels } from '../config.js';
import { sanitizeDisplayText } from '../utils/sanitize.js';

/** Format an untrusted cwd consistently across POSIX and Windows hosts. */
export function formatProjectPath(cwd: string, pathLevels: PathLevels): string {
  const safeCwd = sanitizeDisplayText(cwd);
  const segments = safeCwd.split(/[/\\]/).filter(Boolean);

  if (pathLevels !== 'full') {
    const shown = segments.slice(-pathLevels).join('/');
    return shown || (/^[/\\]/.test(safeCwd) ? '/' : safeCwd);
  }

  if (/^[\\/]{2}/.test(safeCwd)) {
    return segments.length > 0 ? `//${segments.join('/')}` : '//';
  }

  if (/^[A-Za-z]:[\\/]/.test(safeCwd)) {
    const normalized = segments.join('/');
    return segments.length === 1 ? `${normalized}/` : normalized;
  }

  if (/^[\\/]/.test(safeCwd)) {
    return segments.length > 0 ? `/${segments.join('/')}` : '/';
  }

  return segments.join('/') || safeCwd;
}
