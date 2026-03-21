import { execFile } from 'node:child_process';
import { readCache, writeCache } from './cache.js';
import type { Alert, AlertAction } from './types.js';

const ALERT_HISTORY_KEY = 'alert-history';

export interface AlertHistoryEntry {
  type: string;
  message: string;
  timestamp: number;
}

export function recordAlertHistory(alerts: Alert[], cacheDir: string): void {
  if (alerts.length === 0) return;
  const history = readCache<AlertHistoryEntry[]>(ALERT_HISTORY_KEY, 24 * 60 * 60 * 1000, cacheDir) ?? [];
  const now = Date.now();

  for (const alert of alerts) {
    // Only add if not already recorded in last 60 seconds (avoid duplicates from 300ms polling)
    const recent = history.find(h => h.type === alert.type && now - h.timestamp < 60000);
    if (!recent) {
      history.push({ type: alert.type, message: alert.message, timestamp: now });
    }
  }

  // Keep last 100 entries
  while (history.length > 100) history.shift();
  writeCache(ALERT_HISTORY_KEY, history, cacheDir);
}

export function getAlertHistory(cacheDir: string): AlertHistoryEntry[] {
  return readCache<AlertHistoryEntry[]>(ALERT_HISTORY_KEY, 24 * 60 * 60 * 1000, cacheDir) ?? [];
}

interface AlertConfig {
  context: { warningThreshold: number; criticalThreshold: number; actions: AlertAction };
  usage5h: { warningThreshold: number; criticalThreshold: number; actions: AlertAction };
  usage7d: { warningThreshold: number; actions: AlertAction };
}

interface EvaluateInput {
  contextPercent: number;
  usage5hPercent: number;
  usage7dPercent: number;
  estimatedCallsRemaining: number | null;
  usageResetTime: string | null;
  alertConfig: AlertConfig;
  cacheDir: string;
}

const BELL_STATE_KEY = 'alert-bell-state';

export function evaluateAlerts(input: EvaluateInput): Alert[] {
  const { contextPercent, usage5hPercent, usage7dPercent, estimatedCallsRemaining, usageResetTime, alertConfig } = input;
  const alerts: Alert[] = [];

  if (contextPercent >= alertConfig.context.criticalThreshold) {
    const callsHint = estimatedCallsRemaining != null ? ` — ~${estimatedCallsRemaining} calls` : '';
    alerts.push({ type: 'context-critical', message: `Context ${contextPercent}%${callsHint}`, actions: alertConfig.context.actions });
  } else if (contextPercent >= alertConfig.context.warningThreshold) {
    const callsHint = estimatedCallsRemaining != null ? ` — ~${estimatedCallsRemaining} calls to autocompact` : '';
    alerts.push({ type: 'context-warning', message: `Context ${contextPercent}%${callsHint}`, actions: alertConfig.context.actions });
  }

  if (usage5hPercent >= alertConfig.usage5h.criticalThreshold) {
    const resetHint = usageResetTime ? ` — resets ${usageResetTime}` : '';
    alerts.push({ type: 'usage-5h-critical', message: `Usage ${usage5hPercent}%${resetHint}`, actions: alertConfig.usage5h.actions });
  } else if (usage5hPercent >= alertConfig.usage5h.warningThreshold) {
    const resetHint = usageResetTime ? ` — resets ${usageResetTime}` : '';
    alerts.push({ type: 'usage-5h-warning', message: `Usage ${usage5hPercent}%${resetHint}`, actions: alertConfig.usage5h.actions });
  }

  if (usage7dPercent >= alertConfig.usage7d.warningThreshold) {
    alerts.push({ type: 'usage-7d-warning', message: `7d Usage ${usage7dPercent}%`, actions: alertConfig.usage7d.actions });
  }

  return alerts;
}

export function sendNotification(title: string, message: string): void {
  if (process.platform !== 'darwin') return;

  try {
    execFile('osascript', [
      '-e', `display notification "${message.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}"`
    ], { timeout: 2000 });
  } catch {
    // Silent fail — notification is best-effort
  }
}

export function shouldBell(alerts: Alert[], cacheDir: string): boolean {
  const bellAlerts = alerts.filter(a => a.actions.bell);
  if (bellAlerts.length === 0) return false;

  const prevState = readCache<string[]>(BELL_STATE_KEY, 24 * 60 * 60 * 1000, cacheDir) ?? [];
  const currentTypes = bellAlerts.map(a => a.type);
  const newTypes = currentTypes.filter(t => !prevState.includes(t));

  if (newTypes.length > 0) {
    writeCache(BELL_STATE_KEY, currentTypes, cacheDir);
    return true;
  }
  return false;
}

const DEBUG = process.env.DEBUG?.includes('claude-hud') || process.env.DEBUG === '*';

export function predictRateLimitHit(
  currentUsagePercent: number,
  resetAt: Date | null,
  sessionDurationMins: number,
): string | null {
  if (currentUsagePercent <= 0 || sessionDurationMins <= 0) return null;
  if (currentUsagePercent >= 95) return 'imminent';

  // Usage rate per minute
  const usagePerMin = currentUsagePercent / sessionDurationMins;
  if (usagePerMin <= 0) return null;

  const remaining = 100 - currentUsagePercent;
  const minsUntilLimit = Math.round(remaining / usagePerMin);

  if (minsUntilLimit > 300) return null; // > 5h away, not worth showing

  if (minsUntilLimit < 60) return `~${minsUntilLimit}m`;
  const hours = Math.floor(minsUntilLimit / 60);
  const mins = minsUntilLimit % 60;
  return `~${hours}h ${mins}m`;
}

export function sendWebhook(url: string, alert: Alert): void {
  try {
    const payload = JSON.stringify({
      type: alert.type,
      message: alert.message,
      timestamp: new Date().toISOString(),
      source: 'claude-hud',
    });

    // Fire and forget — don't block HUD rendering
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      signal: AbortSignal.timeout(3000),
    }).catch(() => {
      if (DEBUG) console.error('[claude-hud:alert] webhook failed');
    });
  } catch {
    if (DEBUG) console.error('[claude-hud:alert] webhook error');
  }
}

export function runAlertHook(hook: string, alert: Alert): void {
  try {
    const env = {
      ...process.env,
      CLAUDE_HUD_ALERT_TYPE: alert.type,
      CLAUDE_HUD_ALERT_MESSAGE: alert.message,
    };
    execFile('bash', ['-c', hook], { env, timeout: 3000 }, () => {});
  } catch {
    if (DEBUG) console.error('[claude-hud:alert] hook error');
  }
}
