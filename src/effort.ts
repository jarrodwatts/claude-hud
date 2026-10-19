import type { EffortFormatMode } from './config.js';
import type { StdinData } from './types.js';
import { stdinText } from './stdin.js';

export interface EffortInfo {
  level: string;
  symbol: string;
}

const SYMBOLS: Record<string, string> = {
  low: '○',
  medium: '◔',
  high: '◑',
  xhigh: '◕',
  max: '●',
};

export function effortInfo(value: unknown): EffortInfo | null {
  const level = stdinText(value, 32)?.toLowerCase();
  return level ? { level, symbol: SYMBOLS[level] ?? '' } : null;
}

// stdin reports ultracode as an ordinary level, so the transcript marker is what
// distinguishes it; the reported level is wrapped rather than assumed.
export function resolveEffortLevel(effort: StdinData['effort'], ultracodeActive?: boolean): EffortInfo | null {
  const info = effortInfo(effort?.level);
  return info && ultracodeActive === true ? { ...info, level: `ultracode(${info.level})` } : info;
}

/** `◑ high`, `◑`, or `high`, per display.effortFormat. */
export function formatEffort(info: EffortInfo, format: EffortFormatMode | undefined): string {
  // The symbol alone can't carry the ultracode marker, so symbol mode keeps the full form.
  if (format === 'symbol' && info.symbol && !info.level.startsWith('ultracode(')) return info.symbol;
  return format === 'text' || !info.symbol ? info.level : `${info.symbol} ${info.level}`;
}
