import * as fs from 'node:fs';
import * as os from 'node:os';
import type { RenderContext } from '../../types.js';
import { dim, paint } from '../colors.js';

function readCache(filePath: string): string {
  if (!filePath) {
    return '';
  }
  try {
    return fs.readFileSync(filePath, 'utf-8').trim();
  } catch {
    // Missing/unreadable cache → section degrades silently.
    return '';
  }
}

/**
 * Headline cache with optional TTL. Format: "<expiry_unix>|<text>".
 * If expired → '' (a past event is never shown as upcoming). Without a numeric
 * prefix the raw text is returned (backward-compatible plain string).
 */
function parseTtlText(raw: string): string {
  if (!raw) {
    return '';
  }
  const sep = raw.indexOf('|');
  if (sep > 0) {
    const expiry = Number(raw.slice(0, sep));
    if (Number.isFinite(expiry) && expiry > 0) {
      if (Date.now() / 1000 > expiry) {
        return '';
      }
      return raw.slice(sep + 1).trim();
    }
  }
  return raw;
}

/**
 * Portable machine vitals via Node's built-in `os` module — no external
 * scripts, works on any platform. Load average is unavailable on Windows
 * (Node reports 0) so it's omitted there; memory is shown as used-percentage.
 *
 * Note: on macOS `os.freemem()` under-reports free memory (it counts only
 * truly-free pages), so the memory percentage skews high there. It's a
 * lightweight indicator, not an exact gauge.
 */
function machineVitals(): string {
  const parts: string[] = [];

  const load = os.loadavg()[0];
  if (Number.isFinite(load) && load > 0) {
    parts.push(`load ${load.toFixed(1)}`);
  }

  const total = os.totalmem();
  const free = os.freemem();
  if (total > 0) {
    const usedPct = Math.round(((total - free) / total) * 100);
    parts.push(`mem ${usedPct}%`);
  }

  return parts.join(' · ');
}

/**
 * Generic, configurable "panel" element — a brand-able multi-line block:
 *
 *   1. brand + chips     (chips from a pipe-delimited cache file)
 *   2. a TTL'd headline  (e.g. the next calendar event)
 *   3. portable vitals   (load average + memory %)
 *
 * Driven entirely by `config.panel`; opt-in and silent when unconfigured.
 * The cache files are produced by whatever feeder the user wires up — this
 * renderer only reads them, so it stays generic and side-effect free.
 */
export function renderPanelLine(ctx: RenderContext): string | null {
  const panel = ctx.config?.panel;
  if (!panel || !panel.enabled) {
    return null;
  }

  const lines: string[] = [];

  // line 1 — brand + chips
  const chipsRaw = readCache(panel.cacheFile);
  const chips = chipsRaw
    ? chipsRaw.split('|').map(chip => chip.trim()).filter(Boolean)
    : [];
  const brand = panel.brand ? paint(panel.brand, panel.brandColor) : '';
  const body = chips.join(dim(' · '));
  if (brand && body) {
    lines.push(`${brand}  ${body}`);
  } else if (brand || body) {
    lines.push(brand || body);
  }

  // line 2 — TTL headline (disappears once expired)
  const headline = parseTtlText(readCache(panel.calendarCacheFile));
  if (headline) {
    lines.push(headline);
  }

  // line 3 — portable machine vitals
  if (panel.showVitals) {
    const vitals = machineVitals();
    if (vitals) {
      lines.push(dim(vitals));
    }
  }

  return lines.length > 0 ? lines.join('\n') : null;
}
