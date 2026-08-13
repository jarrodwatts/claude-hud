import type { RenderContext } from "../../types.js";
import { label, dim, green, yellow, red, RESET } from "../colors.js";

function formatRemaining(value: number | null): string {
  if (value === null) return '--';
  if (value <= 0) return red('0%');
  if (value < 20) return yellow(String(value) + '%');
  return green(String(value) + '%');
}

export function renderProviderQuotaLine(ctx: RenderContext): string | null {
  const quotaData = ctx.providerQuotaData;
  if (!quotaData || quotaData.entries.length === 0) {
    return null;
  }

  const colors = ctx.config?.colors;

  // Build table: Provider │ 5h Remaining │ Weekly Remaining
  const parts: string[] = [];
  for (const entry of quotaData.entries) {
    if (entry.error && entry.intervalRemainingPercent === null && entry.weeklyRemainingPercent === null) {
      parts.push(`${label(entry.provider + ':', colors)} ${red('⚠ ' + entry.error)}`);
      continue;
    }

    const segments: string[] = [label(entry.provider + ':', colors)];
    if (entry.intervalRemainingPercent !== null) {
      segments.push(`${dim('5h:')}${formatRemaining(entry.intervalRemainingPercent)}`);
    }
    if (entry.weeklyRemainingPercent !== null) {
      segments.push(`${dim('wk:')}${formatRemaining(entry.weeklyRemainingPercent)}`);
    }
    if (entry.error) {
      segments.push(red('⚠'));
    }
    parts.push(segments.join(' '));
  }

  return parts.join(' │ ');
}
