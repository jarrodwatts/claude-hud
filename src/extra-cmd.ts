import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { createDebug } from './debug.js';
import { sanitizeDisplayText } from './utils/sanitize.js';

const execAsync = promisify(exec);

const MAX_BUFFER = 10 * 1024; // 10KB - plenty for a label
const MAX_LABEL_LENGTH = 50;
const TIMEOUT_MS = 3000;
const EXTRA_CMD_ENABLE_ENV = 'CLAUDE_HUD_ALLOW_EXTRA_CMD';

const debug = createDebug('extra-cmd');

export interface ExtraLabel {
  label: string;
}

export function isExtraCmdAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env[EXTRA_CMD_ENABLE_ENV]?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

/**
 * Sanitize output to prevent terminal escape injection.
 * Strips ANSI escapes, OSC sequences, control characters, and bidi controls.
 */
export function sanitize(input: string): string {
  return sanitizeDisplayText(input);
}

/**
 * Parse --extra-cmd argument from process.argv
 * Supports both: --extra-cmd "command" and --extra-cmd="command"
 */
export function parseExtraCmdArg(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    // Handle --extra-cmd=value syntax
    if (arg.startsWith('--extra-cmd=')) {
      if (!isExtraCmdAllowed(env)) {
        debug(`Warning: --extra-cmd ignored because ${EXTRA_CMD_ENABLE_ENV} is not enabled`);
        return null;
      }
      const value = arg.slice('--extra-cmd='.length);
      if (value === '') {
        debug('Warning: --extra-cmd value is empty, ignoring');
        return null;
      }
      return value;
    }

    // Handle --extra-cmd value syntax
    if (arg === '--extra-cmd') {
      if (!isExtraCmdAllowed(env)) {
        debug(`Warning: --extra-cmd ignored because ${EXTRA_CMD_ENABLE_ENV} is not enabled`);
        return null;
      }
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
 * Execute a command and parse output.
 *
 * Preferred output is JSON shaped as { label: string }. Plain stdout is also
 * accepted and summarized from the last non-empty line.
 *
 * Returns null on command errors, timeouts, or empty output.
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
      windowsHide: true,
    });
    const output = stdout.trim();
    if (!output) {
      debug('Command produced empty stdout');
      return null;
    }

    let label: string;
    try {
      const data: unknown = JSON.parse(output);
      if (
        typeof data === 'object' &&
        data !== null &&
        'label' in data &&
        typeof (data as ExtraLabel).label === 'string'
      ) {
        label = (data as ExtraLabel).label;
      } else {
        debug(`Command output missing 'label' field or invalid type: ${JSON.stringify(data)}`);
        return null;
      }
    } catch (err) {
      if (!(err instanceof SyntaxError)) {
        throw err;
      }
      label = summarizePlainOutput(output);
    }

    label = sanitize(label);
    if (!label) {
      return null;
    }
    if (label.length > MAX_LABEL_LENGTH) {
      label = label.slice(0, MAX_LABEL_LENGTH - 1) + '…';
    }
    return label;
  } catch (err) {
    if (err instanceof Error) {
      if (err.message.includes('TIMEOUT') || err.message.includes('killed')) {
        debug(`Command timed out after ${timeout}ms: ${cmd}`);
      } else {
        debug(`Command failed: ${err.message}`);
      }
    } else {
      debug(`Command failed with unknown error`);
    }
    return null;
  }
}

function summarizePlainOutput(output: string): string {
  const lines = output
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  return lines.at(-1) ?? '';
}
