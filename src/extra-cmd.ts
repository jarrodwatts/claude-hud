import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

const MAX_BUFFER = 10 * 1024; // 10KB - plenty for a label
const MAX_LABEL_LENGTH = 50;

export interface ExtraLabel {
  label: string;
}

/**
 * Sanitize output to prevent terminal escape injection.
 * Strips ANSI escapes, OSC sequences, control characters, and bidi controls.
 */
function sanitize(input: string): string {
  return input
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')   // CSI sequences
    .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '') // OSC sequences
    .replace(/\x1B[@-Z\\-_]/g, '')              // 7-bit C1 / ESC Fe
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // C0/C1 controls
    .replace(/[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069\u206A-\u206F]/g, ''); // bidi
}

/**
 * Parse --extra-cmd argument from process.argv
 * Usage: node dist/index.js --extra-cmd "command here"
 */
export function parseExtraCmdArg(argv: string[] = process.argv): string | null {
  const idx = argv.indexOf('--extra-cmd');
  if (idx === -1 || idx + 1 >= argv.length) {
    return null;
  }
  return argv[idx + 1];
}

/**
 * Execute a command and parse JSON output expecting { label: string }
 * Returns null on any error (timeout, parse failure, missing label)
 */
export async function runExtraCmd(cmd: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(cmd, {
      timeout: 3000,
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
    return null;
  } catch {
    return null;
  }
}
