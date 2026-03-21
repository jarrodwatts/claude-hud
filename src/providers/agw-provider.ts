import type { FrameworkProvider, FrameworkStatus, FrameworkEntry } from '../types.js';
import { readCache, writeCache } from '../cache.js';

const CACHE_KEY = 'agw-status';
const SUCCESS_TTL = 3000;
const FAILURE_TTL = 10000;

export class AgwProvider implements FrameworkProvider {
  name = 'agw';
  constructor(private endpoint: string, private cacheDir: string) {}

  isAvailable(): boolean { return true; }

  async fetch(): Promise<FrameworkStatus | null> {
    const failCached = readCache<boolean>('agw-failure', FAILURE_TTL, this.cacheDir);
    if (failCached === true) return null;

    const cached = readCache<FrameworkStatus>(CACHE_KEY, SUCCESS_TTL, this.cacheDir);
    if (cached) return cached;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 200);
      const res = await fetch(`${this.endpoint}/combos`, { signal: controller.signal });
      clearTimeout(timeout);

      if (!res.ok) { writeCache('agw-failure', true, this.cacheDir); return null; }

      const combos = await res.json() as Array<{ id: string; status: string; progress?: string }>;
      const entries: FrameworkEntry[] = combos.map(c => ({
        label: c.id,
        status: c.status === 'running' ? 'running' : c.status === 'error' ? 'error' : 'completed',
        progress: c.progress,
      }));

      const status: FrameworkStatus = { provider: 'AGW', entries };
      writeCache(CACHE_KEY, status, this.cacheDir);
      return status;
    } catch {
      writeCache('agw-failure', true, this.cacheDir);
      return null;
    }
  }
}
