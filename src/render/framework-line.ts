import type { FrameworkStatus } from '../types.js';
import { colorize, claudeOrange, green, dim } from './colors.js';

const STATUS_ICONS: Record<string, string> = {
  running: claudeOrange('⟳'),
  completed: green('✓'),
  error: colorize('✘', '\x1b[31m'),
  waiting: dim('⏳'),
};

export function renderFrameworkLine(statuses: FrameworkStatus[]): string | null {
  if (statuses.length === 0) return null;
  const parts: string[] = [];

  for (const status of statuses) {
    if (status.provider === 'AGW') {
      for (const entry of status.entries) {
        const icon = STATUS_ICONS[entry.status] || dim('?');
        const progress = entry.progress ? dim(` (${entry.progress})`) : '';
        parts.push(`${icon} AGW: ${entry.label}${progress}`);
      }
    } else if (status.provider === 'Teams') {
      const agentParts = status.entries.map(e => {
        const icon = e.status === 'completed' ? green('✓') :
                     e.status === 'running' ? claudeOrange('◐') :
                     e.status === 'error' ? colorize('✘', '\x1b[31m') : dim('⏳');
        return `${e.label}${icon}`;
      }).join(' ');
      parts.push(`${green('⬡')} Teams: ${agentParts}`);
    }
  }

  return parts.length > 0 ? parts.join(` ${dim('│')} `) : null;
}
