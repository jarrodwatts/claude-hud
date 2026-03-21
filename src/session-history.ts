import fs from 'node:fs';
import path from 'node:path';

const DEBUG = process.env.DEBUG?.includes('claude-hud') || process.env.DEBUG === '*';

export interface SessionRecord {
  startTime: string;        // ISO string
  endTime: string;          // ISO string (when last seen)
  duration: string;         // formatted "1h 23m"
  model: string;
  peakContextPercent: number;
  autocompactCount: number;
  totalToolCalls: number;
  totalAgentRuns: number;
}

function getHistoryPath(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(process.env.HOME || '', '.claude');
  return path.join(configDir, 'plugins', 'claude-hud', 'session-history.json');
}

export function loadHistory(): SessionRecord[] {
  try {
    const data = fs.readFileSync(getHistoryPath(), 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    if (DEBUG) console.error('[claude-hud:session-history] file read error:', err);
    return [];
  }
}

export function saveCurrentSession(record: Omit<SessionRecord, 'endTime'>): void {
  const history = loadHistory();
  const now = new Date().toISOString();

  // Check if this is an update to the current session (same startTime)
  const existingIdx = history.findIndex(r => r.startTime === record.startTime);
  const fullRecord: SessionRecord = { ...record, endTime: now };

  if (existingIdx >= 0) {
    history[existingIdx] = fullRecord;
  } else {
    history.push(fullRecord);
  }

  // Keep last 50 sessions
  while (history.length > 50) history.shift();

  const dir = path.dirname(getHistoryPath());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getHistoryPath(), JSON.stringify(history, null, 2));
}

export function getLastSession(): SessionRecord | null {
  const history = loadHistory();
  // Return the second-to-last (last completed session, not current)
  return history.length >= 2 ? history[history.length - 2] : null;
}

export function formatSessionSummary(record: SessionRecord): string {
  return `Last: ${record.model} ${record.duration} | ${record.peakContextPercent}% peak | ${record.totalToolCalls} tools | ${record.autocompactCount} compacts`;
}
