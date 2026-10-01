import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { StdinData } from './types.js';
import { getHudPluginDir } from './claude-config-dir.js';

// Below this much API time a rate is mostly noise (#481).
const MIN_API_DELTA_MS = 500;

interface SpeedState {
  apiDurationMs: number;
  usageKey: string;
  speed: number | null;
}

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

function statePath(homeDir: string, transcriptPath: string): string {
  const key = createHash('sha256').update(path.resolve(transcriptPath)).digest('hex');
  return path.join(getHudPluginDir(homeDir), 'speed-cache', `${key}.json`);
}

function readState(file: string): SpeedState | null {
  try {
    const state = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<SpeedState>;
    const speed = state.speed ?? null;
    return isCount(state.apiDurationMs) && typeof state.usageKey === 'string' && (speed === null || isCount(speed))
      ? { apiDurationMs: state.apiDurationMs, usageKey: state.usageKey, speed }
      : null;
  } catch {
    return null;
  }
}

function writeState(file: string, state: SpeedState): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch {
    // Speed is cosmetic; a read-only home just means no reading.
  }
}

// current_usage.output_tokens only changes when a response finishes, and
// cost.total_api_duration_ms advances by that response's request time in the same
// update, so speed is the finished response's output over the API time it added.
// The reading holds until the next response.
export function getOutputSpeed(stdin: StdinData, homeDir: string): number | null {
  const transcriptPath = stdin.transcript_path?.trim();
  const usage = stdin.context_window?.current_usage;
  const output = usage?.output_tokens;
  const apiDurationMs = stdin.cost?.total_api_duration_ms;
  if (!transcriptPath || !usage || !isCount(output) || !isCount(apiDurationMs)) {
    return null;
  }

  const file = statePath(homeDir, transcriptPath);
  const usageKey = [usage.input_tokens, output, usage.cache_creation_input_tokens, usage.cache_read_input_tokens].join(':');
  const previous = readState(file);
  if (!previous || apiDurationMs < previous.apiDurationMs) {
    writeState(file, { apiDurationMs, usageKey, speed: null });
    return null;
  }
  if (apiDurationMs === previous.apiDurationMs) {
    return previous.speed;
  }

  // API time from requests that leave the main usage untouched (subagents) folds
  // into the baseline instead of being charged to the next response.
  const deltaMs = apiDurationMs - previous.apiDurationMs;
  const isNewResponse = usageKey !== previous.usageKey && output > 0;
  const speed = isNewResponse && deltaMs >= MIN_API_DELTA_MS ? output / (deltaMs / 1000) : previous.speed;
  writeState(file, { apiDurationMs, usageKey, speed });
  return speed;
}
