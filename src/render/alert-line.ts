import type { Alert } from '../types.js';
import { red, dim } from './colors.js';

export function renderAlertLine(alerts: Alert[]): string | null {
  if (alerts.length === 0) return null;
  const parts = alerts.map(alert => {
    const icon = alert.type.includes('critical') ? '⚠' : '⚡';
    return red(`${icon} ${alert.message}`);
  });
  return parts.join(` ${dim('│')} `);
}
