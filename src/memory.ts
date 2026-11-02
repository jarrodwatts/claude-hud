import os from 'node:os';
import type { MemoryInfo } from './types.ts';

type RawMemory = { totalBytes: number; freeBytes: number };
/** The `memory` probe's answer: /proc/meminfo on Linux, vm_stat output on macOS. */
export type MemoryFacts = { meminfo?: string | null; vmStat?: string | null } | null | undefined;

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

// os.freemem() leaves out reclaimable cache, overstating use, so use the OS's own
// accounting where there is one: active + wired pages on macOS, MemAvailable on Linux.
export function readMemory(facts: MemoryFacts): RawMemory {
  const linux = facts?.meminfo ? parseLinuxMeminfo(facts.meminfo) : null;
  if (linux) return linux;
  const vm = facts?.vmStat ? parseVmStat(facts.vmStat) : null;
  if (vm) {
    const totalBytes = os.totalmem();
    return { totalBytes, freeBytes: totalBytes - (vm.active + vm.wired) * vm.pageSize };
  }
  return { totalBytes: os.totalmem(), freeBytes: os.freemem() };
}

export function getMemoryUsage({ totalBytes, freeBytes }: RawMemory): MemoryInfo | null {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
    return null;
  }
  const free = Number.isFinite(freeBytes) ? Math.min(Math.max(freeBytes, 0), totalBytes) : 0;
  const usedBytes = totalBytes - free;
  return { totalBytes, usedBytes, freeBytes: free, usedPercent: Math.round((usedBytes / totalBytes) * 100) };
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
