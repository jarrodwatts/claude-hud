import { statfsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createDebug } from './debug.js';
import type { DiskInfo } from './types.js';

const debug = createDebug('disk');

type DiskReader = (path: string) => { totalBytes: number; freeBytes: number } | null;

/**
 * Parse `df -Pk <path>` output (POSIX mode: a header plus one data row).
 * The "Used" column is ignored on purpose - on APFS it counts only the one
 * volume, not the siblings sharing its container.
 */
export function parseDfOutput(
  output: string,
): { totalBytes: number; freeBytes: number } | null {
  const lines = output.trim().split('\n');
  if (lines.length < 2) return null;

  const columns = lines[lines.length - 1].trim().split(/\s+/);
  if (columns.length < 4) return null;

  const totalBlocks = Number(columns[1]);
  const availableBlocks = Number(columns[3]);
  if (!Number.isFinite(totalBlocks) || !Number.isFinite(availableBlocks)) {
    return null;
  }

  return {
    totalBytes: totalBlocks * 1024,
    freeBytes: availableBlocks * 1024,
  };
}

const readStatfsDisk: DiskReader = (path) => {
  if (typeof statfsSync !== 'function') return null;
  try {
    const stats = statfsSync(path);
    const blockSize = Number(stats.bsize);
    const totalBytes = Number(stats.blocks) * blockSize;
    // bavail is what an unprivileged process may actually use, which is the
    // number Finder/`df` present as free space.
    const freeBytes = Number(stats.bavail) * blockSize;
    if (!Number.isFinite(totalBytes) || !Number.isFinite(freeBytes)) {
      return null;
    }
    return { totalBytes, freeBytes };
  } catch (err) {
    debug('statfs failed for', path, err instanceof Error ? err.message : err);
    return null;
  }
};

const readDfDisk: DiskReader = (path) => {
  try {
    const output = execFileSync('df', ['-Pk', path], {
      encoding: 'utf8',
      timeout: 5000,
    });
    return parseDfOutput(output);
  } catch (err) {
    debug('df failed for', path, err instanceof Error ? err.message : err);
    return null;
  }
};

let readDisk: DiskReader = (path) => readStatfsDisk(path) ?? readDfDisk(path);

/**
 * Disk usage of the filesystem holding `path` (the session cwd), falling back
 * to the process cwd and then the root volume when that path is gone.
 */
export async function getDiskUsage(path?: string | null): Promise<DiskInfo | null> {
  const candidates = [path, process.cwd(), '/'].filter(
    (candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0,
  );

  for (const candidate of candidates) {
    const result = readDisk(candidate);
    if (!result) continue;

    const { totalBytes, freeBytes } = result;
    if (!Number.isFinite(totalBytes) || totalBytes <= 0) continue;

    const safeFreeBytes = Number.isFinite(freeBytes)
      ? Math.min(Math.max(freeBytes, 0), totalBytes)
      : 0;
    const usedBytes = totalBytes - safeFreeBytes;
    const usedPercent = Math.round((usedBytes / totalBytes) * 100);

    return {
      path: candidate,
      totalBytes,
      usedBytes,
      freeBytes: safeFreeBytes,
      usedPercent: Math.min(Math.max(usedPercent, 0), 100),
    };
  }

  return null;
}

export function _setDiskReaderForTests(reader: DiskReader | null): void {
  readDisk = reader ?? ((path) => readStatfsDisk(path) ?? readDfDisk(path));
}
