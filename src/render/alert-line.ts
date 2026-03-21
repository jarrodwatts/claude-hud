import type { Alert } from '../types.js';
import type { Suggestion } from '../suggestions.js';
import { red, dim } from './colors.js';

export function renderAlertLine(alerts: Alert[], suggestions?: Suggestion[]): string | null {
  const parts: string[] = [];

  for (const alert of alerts) {
    const icon = alert.type.includes('critical') ? '⚠' : '⚡';
    parts.push(red(`${icon} ${alert.message}`));
  }

  // Add top suggestion if no critical alerts
  if (suggestions && suggestions.length > 0 && !alerts.some(a => a.type.includes('critical'))) {
    parts.push(dim(`${suggestions[0].icon} ${suggestions[0].message}`));
  }

  return parts.length > 0 ? parts.join(` ${dim('│')} `) : null;
}
