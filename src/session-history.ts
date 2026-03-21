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

export interface SessionComparison {
  durationDelta: string;      // "+15m" or "-5m"
  toolCallsDelta: number;     // +10 or -5
  compactsDelta: number;      // +1 or -1
}

export function compareWithLastSession(
  current: { duration: string; toolCalls: number; compacts: number },
  _cacheDir: string,
): SessionComparison | null {
  const last = getLastSession();
  if (!last) return null;

  const lastMins = parseDurationToMins(last.duration);
  const currentMins = parseDurationToMins(current.duration);

  const durationDelta = currentMins - lastMins;
  const durationStr = durationDelta >= 0 ? `+${durationDelta}m` : `${durationDelta}m`;

  return {
    durationDelta: durationStr,
    toolCallsDelta: current.toolCalls - last.totalToolCalls,
    compactsDelta: current.compacts - last.autocompactCount,
  };
}

export interface DashboardExport {
  exportTime: string;
  sessions: SessionRecord[];
  summary: {
    totalSessions: number;
    totalToolCalls: number;
    avgDurationMins: number;
    totalAutocompacts: number;
  };
}

export function exportDashboard(): DashboardExport {
  const sessions = loadHistory();
  const totalToolCalls = sessions.reduce((sum, s) => sum + s.totalToolCalls, 0);
  const totalAutocompacts = sessions.reduce((sum, s) => sum + s.autocompactCount, 0);
  const totalMins = sessions.reduce((sum, s) => sum + parseDurationToMins(s.duration), 0);

  return {
    exportTime: new Date().toISOString(),
    sessions,
    summary: {
      totalSessions: sessions.length,
      totalToolCalls,
      avgDurationMins: sessions.length > 0 ? Math.round(totalMins / sessions.length) : 0,
      totalAutocompacts,
    },
  };
}

export function parseDurationToMins(duration: string): number {
  const hourMatch = duration.match(/(\d+)h/);
  const minMatch = duration.match(/(\d+)m/);
  return (hourMatch ? parseInt(hourMatch[1]) * 60 : 0) + (minMatch ? parseInt(minMatch[1]) : 0);
}

export interface WeeklySummary {
  weekStart: string;
  weekEnd: string;
  sessionsCount: number;
  totalToolCalls: number;
  totalAgentRuns: number;
  totalAutocompacts: number;
  avgDurationMins: number;
  mostUsedModel: string;
  peakContextPercent: number;
}

export function generateWeeklySummary(): WeeklySummary | null {
  const sessions = loadHistory();
  if (sessions.length === 0) return null;

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const thisWeek = sessions.filter(s => new Date(s.startTime) >= weekAgo);
  if (thisWeek.length === 0) return null;

  const modelCounts: Record<string, number> = {};
  let totalToolCalls = 0;
  let totalAgentRuns = 0;
  let totalAutocompacts = 0;
  let totalMins = 0;
  let peakContext = 0;

  for (const s of thisWeek) {
    totalToolCalls += s.totalToolCalls;
    totalAgentRuns += s.totalAgentRuns;
    totalAutocompacts += s.autocompactCount;
    totalMins += parseDurationToMins(s.duration);
    if (s.peakContextPercent > peakContext) peakContext = s.peakContextPercent;
    modelCounts[s.model] = (modelCounts[s.model] || 0) + 1;
  }

  const mostUsedModel = Object.entries(modelCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';

  return {
    weekStart: weekAgo.toISOString().slice(0, 10),
    weekEnd: now.toISOString().slice(0, 10),
    sessionsCount: thisWeek.length,
    totalToolCalls,
    totalAgentRuns,
    totalAutocompacts,
    avgDurationMins: Math.round(totalMins / thisWeek.length),
    mostUsedModel,
    peakContextPercent: peakContext,
  };
}

export function formatWeeklySummary(summary: WeeklySummary): string {
  return [
    `Week: ${summary.weekStart} — ${summary.weekEnd}`,
    `Sessions: ${summary.sessionsCount} | Avg: ${summary.avgDurationMins}m`,
    `Tools: ${summary.totalToolCalls} | Agents: ${summary.totalAgentRuns} | Compacts: ${summary.totalAutocompacts}`,
    `Model: ${summary.mostUsedModel} | Peak context: ${summary.peakContextPercent}%`,
  ].join('\n');
}
