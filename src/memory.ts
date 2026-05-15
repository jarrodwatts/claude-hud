import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { MemoryInfo } from './types.js';

type MemoryReader = () => { totalBytes: number; freeBytes: number };

export function parseVmStat(
  output: string,
): { pageSize: number; active: number; wired: number; compressor: number } | null {
  const pageSizeMatch = output.match(/page size of (\d+) bytes/);
  if (!pageSizeMatch) return null;

  const activeMatch = output.match(/Pages active:\s+(\d+)/);
  const wiredMatch = output.match(/Pages wired down:\s+(\d+)/);
  if (!activeMatch || !wiredMatch) return null;

  // macOS memory compression (10.9+) stores pressured pages in a compressor
  // region that still occupies real RAM. Activity Monitor's "Memory Used"
  // counts these pages, so we include them here to match. Fall back to 0
  // on outputs that don't report the field (older macOS / stripped output).
  const compressorMatch = output.match(/Pages occupied by compressor:\s+(\d+)/);

  return {
    pageSize: Number(pageSizeMatch[1]),
    active: Number(activeMatch[1]),
    wired: Number(wiredMatch[1]),
    compressor: compressorMatch ? Number(compressorMatch[1]) : 0,
  };
}

export function parseLinuxMeminfo(
  output: string,
): { totalBytes: number; freeBytes: number } | null {
  const totalMatch = output.match(/^MemTotal:\s+(\d+)\s+kB/m);
  const availMatch = output.match(/^MemAvailable:\s+(\d+)\s+kB/m);
  if (!totalMatch || !availMatch) return null;

  const totalBytes = Number(totalMatch[1]) * 1024;
  const freeBytes = Number(availMatch[1]) * 1024;
  if (!Number.isFinite(totalBytes) || !Number.isFinite(freeBytes)) {
    return null;
  }

  return { totalBytes, freeBytes };
}

const readDefaultMemory: MemoryReader = () => ({
  totalBytes: os.totalmem(),
  freeBytes: os.freemem(),
});

const readLinuxMemory: MemoryReader = () => {
  try {
    const content = readFileSync('/proc/meminfo', 'utf8');
    return parseLinuxMeminfo(content) ?? readDefaultMemory();
  } catch {
    return readDefaultMemory();
  }
};

const readMacOSMemory: MemoryReader = () => {
  try {
    const output = execFileSync('/usr/bin/vm_stat', {
      encoding: 'utf8',
      timeout: 5000,
    });
    const parsed = parseVmStat(output);
    if (!parsed) return readDefaultMemory();
    const totalBytes = os.totalmem();
    const usedBytes = (parsed.active + parsed.wired + parsed.compressor) * parsed.pageSize;
    return { totalBytes, freeBytes: totalBytes - usedBytes };
  } catch {
    return readDefaultMemory();
  }
};

let readMemory: MemoryReader =
  process.platform === 'darwin' ? readMacOSMemory :
  process.platform === 'linux' ? readLinuxMemory :
  readDefaultMemory;

export async function getMemoryUsage(): Promise<MemoryInfo | null> {
  try {
    const { totalBytes, freeBytes } = readMemory();
    if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
      return null;
    }

    const safeFreeBytes = Number.isFinite(freeBytes)
      ? Math.min(Math.max(freeBytes, 0), totalBytes)
      : 0;
    const usedBytes = totalBytes - safeFreeBytes;
    const usedPercent = Math.round((usedBytes / totalBytes) * 100);

    return {
      totalBytes,
      usedBytes,
      freeBytes: safeFreeBytes,
      usedPercent: Math.min(Math.max(usedPercent, 0), 100),
    };
  } catch {
    return null;
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const fractionDigits = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(fractionDigits)} ${units[unitIndex]}`;
}

export function _setMemoryReaderForTests(reader: MemoryReader | null): void {
  readMemory = reader ?? (
    process.platform === 'darwin' ? readMacOSMemory :
    process.platform === 'linux' ? readLinuxMemory :
    readDefaultMemory
  );
}
