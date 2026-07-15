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
export function isExtraCmdAllowed(env = process.env) {
    const value = env[EXTRA_CMD_ENABLE_ENV]?.trim().toLowerCase();
    return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}
/**
 * Sanitize output to prevent terminal escape injection.
 * Strips ANSI escapes, OSC sequences, control characters, and bidi controls.
 */
export function sanitize(input) {
    return sanitizeDisplayText(input);
}
/**
 * Parse --extra-cmd argument from process.argv
 * Supports both: --extra-cmd "command" and --extra-cmd="command"
 */
export function parseExtraCmdArg(argv = process.argv, env = process.env) {
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
 * Execute a command and parse JSON output expecting { label: string }
 * Returns null on any error (timeout, parse failure, missing label)
 *
 * SECURITY NOTE: The cmd parameter is sourced exclusively from CLI arguments
 * (--extra-cmd) typed by the user. Since the user controls their own shell,
 * shell injection is not a concern here - it's intentional user input.
 */
export async function runExtraCmd(cmd, timeout = TIMEOUT_MS) {
    try {
        const { stdout } = await execAsync(cmd, {
            timeout,
            maxBuffer: MAX_BUFFER,
            windowsHide: true,
        });
        const data = JSON.parse(stdout.trim());
        if (typeof data === 'object' &&
            data !== null &&
            'label' in data &&
            typeof data.label === 'string') {
            let label = sanitize(data.label);
            if (label.length > MAX_LABEL_LENGTH) {
                label = label.slice(0, MAX_LABEL_LENGTH - 1) + '…';
            }
            return label;
        }
        debug(`Command output missing 'label' field or invalid type: ${JSON.stringify(data)}`);
        return null;
    }
    catch (err) {
        if (err instanceof Error) {
            if (err.message.includes('TIMEOUT') || err.message.includes('killed')) {
                debug(`Command timed out after ${timeout}ms: ${cmd}`);
            }
            else if (err instanceof SyntaxError) {
                debug(`Failed to parse JSON output: ${err.message}`);
            }
            else {
                debug(`Command failed: ${err.message}`);
            }
        }
        else {
            debug(`Command failed with unknown error`);
        }
        return null;
    }
}
//# sourceMappingURL=extra-cmd.js.map