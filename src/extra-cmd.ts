import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export interface ExtraLabel {
  label: string;
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
    });
    const data: unknown = JSON.parse(stdout.trim());
    if (
      typeof data === 'object' &&
      data !== null &&
      'label' in data &&
      typeof (data as ExtraLabel).label === 'string'
    ) {
      return (data as ExtraLabel).label;
    }
    return null;
  } catch {
    return null;
  }
}
