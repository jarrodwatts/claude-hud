import fs from 'node:fs';
import path from 'node:path';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  mtime?: number;
}

type CacheStore = Record<string, CacheEntry<unknown>>;

function getCacheFile(cacheDir: string): string {
  return path.join(cacheDir, 'cache.json');
}

function loadStore(cacheDir: string): CacheStore {
  try {
    const file = getCacheFile(cacheDir);
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return {};
  }
}

function saveStore(cacheDir: string, store: CacheStore): void {
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(getCacheFile(cacheDir), JSON.stringify(store));
}

export function readCache<T>(key: string, ttlMs: number, cacheDir: string, mtime?: number): T | null {
  const store = loadStore(cacheDir);
  const entry = store[key] as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() - entry.timestamp > ttlMs) return null;
  if (mtime !== undefined && entry.mtime !== mtime) return null;
  return entry.data;
}

export function writeCache<T>(key: string, data: T, cacheDir: string, mtime?: number): void {
  const store = loadStore(cacheDir);
  store[key] = { data, timestamp: Date.now(), mtime };
  saveStore(cacheDir, store);
}

export function getDefaultCacheDir(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(process.env.HOME || '', '.claude');
  return path.join(configDir, 'plugins', 'claude-hud', '.cache');
}
