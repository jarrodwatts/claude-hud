import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

type RawCpu = { user: number; sys: number; idle: number };

/** The `cpu` probe's answer: top output on both Linux and macOS. */
export type CpuFacts = { top?: string | null } | null | undefined;

/** Parse "CPU usage: XX% user, XX% sys, XX% idle" from macOS top -l 1 */
function parseMacosTop(output: string): RawCpu | null {
  const match = /CPU usage:\s+([\d.]+)%\s*user,\s+([\d.]+)%\s*sys,\s+([\d.]+)%\s*idle/i.exec(output);
  if (!match) return null;
  return {
    user: Number(match[1]),
    sys: Number(match[2]),
    idle: Number(match[3]),
  };
}

/** Parse "top" output on Linux - look for %Cpu in the header */
function parseLinuxTop(output: string): RawCpu | null {
  // Linux top -b -n 1 shows: %Cpu(s):  5.9 us,  2.8 sy,  0.0 ni, 91.3 id
  const match = /%Cpu\(s\):\s+([\d.]+)\s*us,\s+([\d.]+)\s*sy,\s+([\d.]+)\s*id/i.exec(output);
  if (!match) return null;
  return {
    user: Number(match[1]),
    sys: Number(match[2]),
    idle: Number(match[3]),
  };
}

/** Read the CPU facts from the probe answer, and parse to RawCpu. */
export function readCpu(facts: CpuFacts): RawCpu | null {
  if (!facts?.top) return null;
  // Try macOS format first (most common on Darwin)
  const macos = parseMacosTop(facts.top);
  if (macos) return macos;
  // Fall back to Linux format
  const linux = parseLinuxTop(facts.top);
  if (linux) return linux;
  return null;
}

/** Compute CPU utilization from the current sample.
 *  For macOS, we use the instant percentage (user+sys as a percentage of total).
 *  For Linux, we use delta over time (requires two samples from data file).
 *  The dataDir parameter specifies where to store the previous sample file (Linux only).
 */
export function getCpuUsage(current: RawCpu, dataDir: string, platform: string = process.platform): { usedPercent: number; numCores: number } | null {
  const numCores = os.cpus().length;

  if (platform === 'darwin') {
    // On macOS, top gives instant percentages
    // used = user + sys (the percentage of time the CPU was actively doing work)
    const usedPercent = Math.round(current.user + current.sys);
    return { usedPercent, numCores };
  }

  // On Linux, use /proc/stat approach (tick counts, need two samples)
  const samplePath = path.join(dataDir, '.cpu_previous');

  function readPreviousSample(): RawCpu | null {
    try {
      const content = fs.readFileSync(samplePath, 'utf8').trim();
      if (!content) return null;
      const [user, sys, idle] = content.split(/[\s,]+/).map(Number);
      if (!Number.isFinite(user) || !Number.isFinite(sys) || !Number.isFinite(idle)) return null;
      return { user, sys, idle };
    } catch {
      return null;
    }
  }

  function writePreviousSample(sample: RawCpu): void {
    try {
      fs.writeFileSync(samplePath, `${sample.user},${sample.sys},${sample.idle}`);
    } catch {
      // If we can't write, just continue
    }
  }

  // We need two samples to compute utilization on Linux
  const previousSample = readPreviousSample();

  // On first call, just store the sample and wait for the next render
  if (!previousSample) {
    writePreviousSample(current);
    return null; // Need two samples for first reading
  }

  // Calculate total CPU time for both samples
  const prevTotal = previousSample.user + previousSample.sys + previousSample.idle;
  const currTotal = current.user + current.sys + current.idle;

  // Calculate the difference
  const totalDiff = currTotal - prevTotal;
  const idleDiff = current.idle - previousSample.idle;

  if (totalDiff <= 0 || !Number.isFinite(totalDiff)) {
    // Store current and wait for next sample
    writePreviousSample(current);
    return null;
  }

  const usedPercent = Math.round(((totalDiff - idleDiff) / totalDiff) * 100);

  // Store current sample for next render
  writePreviousSample(current);

  return { usedPercent, numCores };
}