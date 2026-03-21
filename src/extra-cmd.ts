import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

const MAX_BUFFER = 10 * 1024; // 10KB - plenty for a label
const MAX_LABEL_LENGTH = 50;
const TIMEOUT_MS = 3000;

const isDebug = process.env.DEBUG?.includes('claude-hud') ?? false;

const SHELL_ESCAPE_RE = /[\x00-\x1f\x7f`$\\]/g;
const CONSECUTIVE_SPACES_RE = /\s{2,}/g;
const LEADING_TRAILING_SPACES_RE = /^\s+|\s+$/g;

// ANSI/control sequence patterns used in sanitize()
const CSI_SEQUENCE_RE = /\x1B\[[0-?]*[ -/]*[@-~]/g;
const OSC_SEQUENCE_RE = /\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g;
const C1_ESCAPE_RE = /\x1B[@-Z\\-_]/g;
const CONTROL_CHARS_RE = /[\u0000-\u001F\u007F-\u009F]/g;
const BIDI_CHARS_RE = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069\u206A-\u206F]/g;

function debug(message: string): void {
  if (isDebug) {
    console.error(`[claude-hud:extra-cmd] ${message}`);
  }
}

interface ExtraLabel {
  label: string;
}

/**
 * Sanitize output to prevent terminal escape injection.
 * Strips ANSI escapes, OSC sequences, control characters, and bidi controls.
 */
export function sanitize(input: string): string {
  return input
    .replace(CSI_SEQUENCE_RE, '') // CSI sequences
    .replace(OSC_SEQUENCE_RE, '') // OSC sequences
    .replace(C1_ESCAPE_RE, '') // 7-bit C1 / ESC Fe
    .replace(CONTROL_CHARS_RE, '') // C0/C1 controls
    .replace(BIDI_CHARS_RE, ''); // bidi
}

/**
 * Parse --extra-cmd argument from process.argv
 * Supports both: --extra-cmd "command" and --extra-cmd="command"
 */
export function parseExtraCmdArg(argv: string[] = process.argv): string | null {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    // Handle --extra-cmd=value syntax
    if (arg.startsWith('--extra-cmd=')) {
      const value = arg.slice('--extra-cmd='.length);
      if (value === '') {
        debug('Warning: --extra-cmd value is empty, ignoring');
        return null;
      }
      return value;
    }

    // Handle --extra-cmd value syntax
    if (arg === '--extra-cmd') {
      if (i + 1 >= argv.length) {
        debug('Warning: --extra-cmd specified but no value provided');
        return null;
      }
      const value = argv[i + 1];
      if (value === '') {
        debug('Warning: --extra-cmd value is empty, ignoring');
        return null;
      }
      return value;
    }
  }

  return null;
}

/**
 * Execute a command and parse JSON output expecting { label: string }
 * Returns null on any error (timeout, parse failure, missing label)
 *
 * SECURITY NOTE: The cmd parameter is sourced exclusively from CLI arguments
 * (--extra-cmd) typed by the user. Since the user controls their own shell,
 * shell injection is not a concern here - it's intentional user input.
 */
export async function runExtraCmd(cmd: string, timeout: number = TIMEOUT_MS): Promise<string | null> {
  try {
    const { stdout } = await execAsync(cmd, {
      timeout,
      maxBuffer: MAX_BUFFER,
    });
    const data: unknown = JSON.parse(stdout.trim());
    if (
      typeof data === 'object' &&
      data !== null &&
      'label' in data &&
      typeof (data as ExtraLabel).label === 'string'
    ) {
      let label = sanitize((data as ExtraLabel).label);
      if (label.length > MAX_LABEL_LENGTH) {
        label = label.slice(0, MAX_LABEL_LENGTH - 1) + '…';
      }
      return label;
    }
    debug(`Command output missing 'label' field or invalid type: ${JSON.stringify(data)}`);
    return null;
  } catch (err) {
    if (err instanceof Error) {
      if (err.message.includes('TIMEOUT') || err.message.includes('killed')) {
        debug(`Command timed out after ${timeout}ms: ${cmd}`);
      } else if (err instanceof SyntaxError) {
        debug(`Failed to parse JSON output: ${err.message}`);
      } else {
        debug(`Command failed: ${err.message}`);
      }
    } else {
      debug(`Command failed with unknown error`);
    }
    return null;
  }
}
