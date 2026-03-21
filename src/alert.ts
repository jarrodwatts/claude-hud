import { execFile } from 'node:child_process';
import { readCache, writeCache } from './cache.js';
import type { Alert, AlertAction } from './types.js';

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
