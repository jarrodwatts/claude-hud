import os from 'node:os';
import type { CpuInfo } from './types.ts';

type RawCpu = { total: number; idle: number };

/** The `cpu` probe's answer: /proc/stat on Linux, sysctl on macOS. */
export type CpuFacts = { linuxStat?: string | null; macosSysctl?: string | null } | null | undefined;

function parseLinuxStat(output: string): RawCpu | null {
  const line = output.split('\n').find(l => l.startsWith('cpu '));
  if (!line) return null;
  const parts = line.trim().split(/\s+/).slice(1).map(Number);
  if (parts.length < 4) return null;
  const [user, nice, system, idle, ...rest] = parts;
  const total = user + nice + system + idle + rest.reduce((a, b) => a + b, 0);
  return { total, idle };
}

function parseMacosSysctl(output: string): RawCpu | null {
  // sysctl -n kern.cp_time returns: user nice sys idle interrupt
  const parts = output.trim().split(/\s+/).map(Number);
  if (parts.length < 4) return null;
  const [user, nice, sys, idle, ...rest] = parts;
  const total = user + nice + sys + idle + rest.reduce((a, b) => a + b, 0);
  return { total, idle };
}

// We need two samples to compute utilization. Store the previous sample.
let previousSample: RawCpu | null = null;
let previousTime: number | null = null;

export function readCpu(facts: CpuFacts): RawCpu | null {
  const linux = facts?.linuxStat ? parseLinuxStat(facts.linuxStat) : null;
  if (linux) return linux;
  const macos = facts?.macosSysctl ? parseMacosSysctl(facts.macosSysctl) : null;
  if (macos) return macos;
  return null;
}

export function getCpuUsage(current: RawCpu): CpuInfo | null {
  if (!previousSample || !previousTime) {
    previousSample = current;
    previousTime = Date.now();
    return null; // Need two samples for first reading
  }

  const now = Date.now();
  const timeDiff = now - previousTime;
  if (timeDiff < 100) {
    // Too soon, return previous if we have one, else null
    if (previousSample !== current) return null;
  }

  const totalDiff = current.total - previousSample.total;
  const idleDiff = current.idle - previousSample.idle;

  if (totalDiff <= 0) {
    previousSample = current;
    previousTime = now;
    return null;
  }

  const usedPercent = Math.round(((totalDiff - idleDiff) / totalDiff) * 100);
  const numCores = os.cpus().length;

  previousSample = current;
  previousTime = now;

  return { usedPercent, numCores };
}

export function resetCpuSample(): void {
  previousSample = null;
  previousTime = null;
}