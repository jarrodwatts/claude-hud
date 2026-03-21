import fs from 'node:fs';
import path from 'node:path';
import { getDefaultCacheDir } from './cache.js';

const DEBUG = process.env.DEBUG?.includes('claude-hud') || process.env.DEBUG === '*';

interface SessionLock {
  pid: number;
  startTime: string;
  cwd?: string;
}

function getLocksDir(): string {
  return path.join(getDefaultCacheDir(), 'sessions');
}

export function registerSession(cwd?: string): void {
  const dir = getLocksDir();
  fs.mkdirSync(dir, { recursive: true });
  const lockFile = path.join(dir, `${process.pid}.json`);
  const lock: SessionLock = {
    pid: process.pid,
    startTime: new Date().toISOString(),
    cwd,
  };
  fs.writeFileSync(lockFile, JSON.stringify(lock));
}

export function getActiveSessions(): SessionLock[] {
  const dir = getLocksDir();
  if (!fs.existsSync(dir)) return [];

  const sessions: SessionLock[] = [];
  try {
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')) as SessionLock;
        // Check if PID is still alive
        try {
          process.kill(data.pid, 0); // Signal 0 = check existence
          sessions.push(data);
        } catch {
          // PID dead — clean up stale lock
          fs.unlinkSync(path.join(dir, file));
        }
      } catch {
        if (DEBUG) console.error(`[claude-hud:session] bad lock file: ${file}`);
      }
    }
  } catch {
    // dir read failed
  }
  return sessions;
}

export function getSessionCount(): number {
  return getActiveSessions().length;
}

export function cleanupSession(): void {
  try {
    const lockFile = path.join(getLocksDir(), `${process.pid}.json`);
    if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile);
  } catch {}
}
