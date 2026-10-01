import os from 'node:os';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createDebug } from './debug.js';
import type { MemoryInfo } from './types.js';

const debug = createDebug('memory');

const VM_STAT_TIMEOUT_MS = 1000;

type RawMemory = { totalBytes: number; freeBytes: number };
type MemoryReader = () => RawMemory | Promise<RawMemory>;

export function parseVmStat(output: string): { pageSize: number; active: number; wired: number } | null {
  const pageSize = /page size of (\d+) bytes/.exec(output)?.[1];
  const active = /Pages active:\s+(\d+)/.exec(output)?.[1];
  const wired = /Pages wired down:\s+(\d+)/.exec(output)?.[1];
  return pageSize && active && wired
    ? { pageSize: Number(pageSize), active: Number(active), wired: Number(wired) }
    : null;
}

export function parseLinuxMeminfo(output: string): RawMemory | null {
  const total = /^MemTotal:\s+(\d+)\s+kB/m.exec(output)?.[1];
  const available = /^MemAvailable:\s+(\d+)\s+kB/m.exec(output)?.[1];
  return total && available ? { totalBytes: Number(total) * 1024, freeBytes: Number(available) * 1024 } : null;
}

const systemMemory = (): RawMemory => ({ totalBytes: os.totalmem(), freeBytes: os.freemem() });

function runVmStat(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/vm_stat', { encoding: 'utf8', timeout: VM_STAT_TIMEOUT_MS }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

// os.freemem() leaves out reclaimable cache, overstating use, so read the OS's own
// accounting where it is cheap: active + wired pages on macOS, MemAvailable on Linux.
async function readPlatformMemory(): Promise<RawMemory> {
  try {
    if (process.platform === 'linux') {
      return parseLinuxMeminfo(await readFile('/proc/meminfo', 'utf8')) ?? systemMemory();
    }
    if (process.platform === 'darwin') {
      const vm = parseVmStat(await runVmStat());
      if (vm) {
        const totalBytes = os.totalmem();
        return { totalBytes, freeBytes: totalBytes - (vm.active + vm.wired) * vm.pageSize };
      }
    }
  } catch (err) {
    debug('Falling back to os.freemem():', err instanceof Error ? err.message : err);
  }
  return systemMemory();
}

let readMemory: MemoryReader = readPlatformMemory;

export async function getMemoryUsage(): Promise<MemoryInfo | null> {
  try {
    const { totalBytes, freeBytes } = await readMemory();
    if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
      return null;
    }
    const free = Number.isFinite(freeBytes) ? Math.min(Math.max(freeBytes, 0), totalBytes) : 0;
    const usedBytes = totalBytes - free;
    return { totalBytes, usedBytes, freeBytes: free, usedPercent: Math.round((usedBytes / totalBytes) * 100) };
  } catch (err) {
    debug('Failed to get memory usage:', err instanceof Error ? err.message : err);
    return null;
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function _setMemoryReaderForTests(reader: MemoryReader | null): void {
  readMemory = reader ?? readPlatformMemory;
}
