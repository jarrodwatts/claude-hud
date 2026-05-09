import type { RenderContext } from '../../types.js';
import { dim, RESET } from '../colors.js';

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatStartDate(date: Date): string {
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const min = pad(date.getMinutes());
  return `${y}-${m}-${d} ${h}:${min}`;
}

function formatRelativeTime(ms: number): string {
  if (ms < 0) {
    return 'just now';
  }
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) {
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m ago` : `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h ago` : `${days}d ago`;
}

export function renderSessionTimeLine(ctx: RenderContext, nowFn?: () => number): string | null {
  const display = ctx.config?.display;
  const showStart = display?.showSessionStartDate === true;
  const showLastReply = display?.showLastResponseAt === true;

  if (!showStart && !showLastReply) {
    return null;
  }

  const parts: string[] = [];

  if (showStart && ctx.transcript.sessionStart) {
    const startStr = formatStartDate(ctx.transcript.sessionStart);
    parts.push(`${dim}Started:${RESET} ${startStr}`);
  }

  if (showLastReply && ctx.transcript.lastAssistantResponseAt) {
    const now = nowFn ? nowFn() : Date.now();
    const elapsed = now - ctx.transcript.lastAssistantResponseAt.getTime();
    parts.push(`${dim}Last reply:${RESET} ${formatRelativeTime(elapsed)}`);
  }

  if (parts.length === 0) {
    return null;
  }

  return parts.join(` ${dim}│${RESET} `);
}
