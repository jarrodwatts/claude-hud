import { execSync } from 'child_process';

export const UNKNOWN_TERMINAL_WIDTH = 40;

/**
 * Windows-specific fallback: query the actual terminal window width via PowerShell.
 *
 * When Claude Code runs the statusLine command as a subprocess with piped stdout,
 * Windows ConPTY causes process.stdout.columns and process.stderr.columns to both
 * return 0. The COLUMNS environment variable is also unset. As a result, the normal
 * fallback chain silently bottoms out at UNKNOWN_TERMINAL_WIDTH (40), which causes
 * the HUD to wrap into 4+ lines instead of the intended 2.
 *
 * $Host.UI.RawUI.WindowSize.Width reads the width from the Windows Console API,
 * bypassing the ConPTY layer and returning the true terminal window width.
 *
 * Returns the width as a positive integer, or null if detection fails or the
 * platform is not Windows.
 */
export function getWindowsTerminalWidth(): number | null {
  if (process.platform !== 'win32') return null;
  try {
    const raw = execSync(
      'powershell.exe -NoProfile -Command "$Host.UI.RawUI.WindowSize.Width"',
      {
        encoding: 'utf8',
        // Prevent a slow or unavailable PowerShell from blocking HUD rendering.
        timeout: 1000,
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    ).trim();
    const width = parseInt(raw, 10);
    return Number.isFinite(width) && width > 0 ? width : null;
  } catch {
    // PowerShell unavailable or returned a non-numeric value; fall through to
    // the caller's own fallback.
    return null;
  }
}

// Returns a progress bar width scaled to the current terminal width.
// Wide (>=100): 10, Medium (60-99): 6, Narrow (<60): 4.
export function getAdaptiveBarWidth(): number {
  const stdoutCols = process.stdout?.columns;
  const cols = (typeof stdoutCols === 'number' && Number.isFinite(stdoutCols) && stdoutCols > 0)
    ? Math.floor(stdoutCols)
    : Number.parseInt(process.env.COLUMNS ?? '', 10);

  if (Number.isFinite(cols) && cols > 0) {
    if (cols >= 100) return 10;
    if (cols >= 60) return 6;
    return 4;
  }

  // Neither stdout.columns nor COLUMNS env var is available (e.g. Windows ConPTY).
  // Try the PowerShell fallback before giving up.
  const winWidth = getWindowsTerminalWidth();
  if (winWidth !== null) {
    if (winWidth >= 100) return 10;
    if (winWidth >= 60) return 6;
    return 4;
  }

  return 10;
}
