import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { extractRecentMessages } from './transcript.js';
import { createDebug } from './debug.js';
import type { SummaryData } from './types.js';

const debug = createDebug('summary');

interface SummaryCache {
  lastTurnCount: number;
  turnCount: number;
  summary: [string, string];
  timestamp: number;
}

export type SummaryDeps = {
  homeDir: () => string;
  now: () => number;
  extractRecentMessages: typeof extractRecentMessages;
  spawnWorker: (transcriptPath: string, turnCount: number) => void;
};

const LOCK_STALE_MS = 60_000;

function getPluginDir(homeDir: string): string {
  return path.join(homeDir, '.claude', 'plugins', 'claude-hud');
}

function sessionHash(transcriptPath: string): string {
  return createHash('md5').update(transcriptPath).digest('hex').slice(0, 8);
}

function getCachePath(homeDir: string, transcriptPath: string): string {
  return path.join(getPluginDir(homeDir), `.summary-${sessionHash(transcriptPath)}.json`);
}

function getLockPath(homeDir: string, transcriptPath: string): string {
  return path.join(getPluginDir(homeDir), `.summary-${sessionHash(transcriptPath)}.lock`);
}

function readCache(homeDir: string, transcriptPath: string): SummaryCache | null {
  try {
    const cachePath = getCachePath(homeDir, transcriptPath);
    if (!fs.existsSync(cachePath)) return null;
    const content = fs.readFileSync(cachePath, 'utf8');
    return JSON.parse(content) as SummaryCache;
  } catch {
    return null;
  }
}

function isLocked(homeDir: string, transcriptPath: string, now: number): boolean {
  try {
    const lockPath = getLockPath(homeDir, transcriptPath);
    if (!fs.existsSync(lockPath)) return false;
    const timestamp = parseInt(fs.readFileSync(lockPath, 'utf8'), 10);
    if (now - timestamp > LOCK_STALE_MS) {
      fs.unlinkSync(lockPath);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function defaultSpawnWorker(transcriptPath: string, turnCount: number): void {
  const distDir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..', 'dist'
  );
  const workerPath = path.join(distDir, 'summary-worker.js');

  const cleanEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key !== 'CLAUDECODE' && value !== undefined) {
      cleanEnv[key] = value;
    }
  }

  const child = spawn('node', [workerPath, transcriptPath, String(turnCount)], {
    detached: true,
    stdio: 'ignore',
    env: cleanEnv,
  });
  child.unref();
  debug('Spawned summary worker, pid:', child.pid);
}

const defaultDeps: SummaryDeps = {
  homeDir: () => os.homedir(),
  now: () => Date.now(),
  extractRecentMessages,
  spawnWorker: defaultSpawnWorker,
};

export async function getSummary(
  transcriptPath: string,
  interval: number,
  overrides: Partial<SummaryDeps> = {}
): Promise<SummaryData | null> {
  const deps = { ...defaultDeps, ...overrides };
  const homeDir = deps.homeDir();
  const now = deps.now();

  if (!transcriptPath) return null;

  const { turnCount } = await deps.extractRecentMessages(transcriptPath, 1);
  const cache = readCache(homeDir, transcriptPath);

  if (cache && turnCount - cache.lastTurnCount < interval) {
    return {
      turnCount,
      lastTurnCount: cache.lastTurnCount,
      summary: cache.summary,
      timestamp: cache.timestamp,
    };
  }

  if (turnCount < interval) {
    return { turnCount, lastTurnCount: 0, summary: null, timestamp: deps.now() };
  }

  if (!isLocked(homeDir, transcriptPath, now)) {
    deps.spawnWorker(transcriptPath, turnCount);
  }

  if (cache) {
    return {
      turnCount,
      lastTurnCount: cache.lastTurnCount,
      summary: cache.summary,
      timestamp: cache.timestamp,
    };
  }

  return { turnCount, lastTurnCount: 0, summary: null, timestamp: deps.now() };
}
