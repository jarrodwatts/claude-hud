import { exec } from 'node:child_process';
import { createDebug } from './debug.js';
import { sanitizeDisplayText } from './utils/sanitize.js';

const debug = createDebug('extra-cmd');

const MAX_OUTPUT_BYTES = 10 * 1024;
const MAX_LABEL_LENGTH = 50;
const TIMEOUT_MS = 3000;

// --extra-cmd runs an arbitrary shell command, so it needs an explicit opt-in in the environment.
export function isExtraCmdAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return ['1', 'true', 'yes', 'on'].includes(env.CLAUDE_HUD_ALLOW_EXTRA_CMD?.trim().toLowerCase() ?? '');
}

// Accepts `--extra-cmd "cmd"` and `--extra-cmd="cmd"`; the first occurrence wins.
export function parseExtraCmdArg(argv: string[] = process.argv, env: NodeJS.ProcessEnv = process.env): string | null {
  const index = argv.findIndex((arg) => arg === '--extra-cmd' || arg.startsWith('--extra-cmd='));
  if (index === -1) return null;
  if (!isExtraCmdAllowed(env)) {
    debug('--extra-cmd ignored because CLAUDE_HUD_ALLOW_EXTRA_CMD is not enabled');
    return null;
  }
  const arg = argv[index];
  return (arg === '--extra-cmd' ? argv[index + 1] : arg.slice('--extra-cmd='.length)) || null;
}

// The command prints JSON `{ "label": "..." }`, or plain text whose last non-empty line is the label.
function toLabel(output: string): string | null {
  let label: unknown;
  try {
    const data: unknown = JSON.parse(output);
    label = data !== null && typeof data === 'object' ? (data as { label?: unknown }).label : undefined;
  } catch {
    label = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1);
  }
  if (typeof label !== 'string') return null;
  const clean = sanitizeDisplayText(label);
  if (!clean) return null;
  return clean.length > MAX_LABEL_LENGTH ? `${clean.slice(0, MAX_LABEL_LENGTH - 1)}…` : clean;
}

export function runExtraCmd(cmd: string, timeout: number = TIMEOUT_MS): Promise<string | null> {
  return new Promise((resolve) => {
    exec(cmd, { timeout, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true }, (error, stdout) => {
      if (error) {
        debug(`Command failed: ${error.message}`);
        resolve(null);
        return;
      }
      const output = String(stdout).trim();
      resolve(output ? toLabel(output) : null);
    });
  });
}
