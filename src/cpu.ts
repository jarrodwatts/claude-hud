import os from 'node:os';

type RawCpu = { total: number; idle: number };

/** The `cpu` probe's answer: /proc/stat on Linux, sysctl on macOS. */
export type CpuFacts = { linuxStat?: string | null; macosSysctl?: string | null } | null | undefined;

function parseLinuxStat(output: string): RawCpu | null {
  const line = output.split('\n').find(l => l.startsWith('cpu '));
  if (!line) return null;
  const parts = line.trim().split(/\s+/).slice(1).map(Number);
  if (parts.length < 4) return null;
  // /proc/stat format: user nice system idle iowait irq softirq steal guest guest_nice
  // We need user, nice, system, idle (and optionally iowait, irq, softirq, steal, guest, guest_nice)
  // Guest time is included in user/nice on modern kernels, so we exclude explicit guest fields
  const [user, nice, system, idle, ...rest] = parts;
  // Sum all values except guest/guest_nice (which are included in user/nice on modern kernels)
  // Format: user nice system idle iowait irq softirq steal guest guest_nice
  // We take user+nice+system+idle+iowait+irq+softirq+steal (excluding guest fields)
  const total = user + nice + system + idle + rest.slice(0, 4).reduce((a, b) => a + b, 0);
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

// We need two samples to compute utilization.
// Since each render runs a fresh caged process, we persist the previous sample in a file under data/.
// On first render, previousSample is null and we return null (need two samples).
// On subsequent renders, the file persists the state.
const DATA_DIR = process.env.CLAUDE_HUD_DATA_DIR || '/Users/sudip/work/aitrade/claude-hud-dev/data';

function readPreviousSample(): RawCpu | null {
  try {
    const path = `${DATA_DIR}/.cpu_previous`;
    const content = require('fs').readFileSync(path, 'utf8').trim();
    if (!content) return null;
    const [total, idle] = content.split(/\s+/).map(Number);
    return { total, idle };
  } catch {
    return null;
  }
}

function writePreviousSample(sample: RawCpu): void {
  try {
    const path = `${DATA_DIR}/.cpu_previous`;
    require('fs').writeFileSync(path, `${sample.total} ${sample.idle}`);
  } catch {
    // If we can't write, just continue without persisting; next render will recalculate
  }
}

// We need two samples to compute utilization.
let previousSample: RawCpu | null = readPreviousSample();

/** Read the CPU facts from the probe answer, and compute usage percentage. */
export function readCpu(facts: CpuFacts): RawCpu | null {
  const linux = facts?.linuxStat ? parseLinuxStat(facts.linuxStat) : null;
  if (linux) return linux;
  const macos = facts?.macosSysctl ? parseMacosSysctl(facts.macosSysctl) : null;
  if (macos) return macos;
  return null;
}

/** Compute CPU utilization from the current sample.
 *  On first call (no previous sample), store this sample and return null (need two samples).
 *  On subsequent calls, compute utilization from the delta between samples.
 */
export function getCpuUsage(current: RawCpu): { usedPercent: number; numCores: number } | null {
  // On first call, just store the sample and wait for the next render
  if (!previousSample) {
    previousSample = current;
    // Persist across renders so the next invocation can compute delta
    writePreviousSample(current);
    return null; // Need two samples for first reading
  }

  const totalDiff = current.total - previousSample.total;
  const idleDiff = current.idle - previousSample.idle;

  if (totalDiff <= 0) {
    // Store current and wait for next sample
    previousSample = current;
    writePreviousSample(current);
    return null;
  }

  const usedPercent = Math.round(((totalDiff - idleDiff) / totalDiff) * 100);
  const numCores = os.cpus().length;

  // Store current sample for next render
  previousSample = current;
  writePreviousSample(current);

  return { usedPercent, numCores };
}

/** Reset the CPU sample state. */
export function resetCpuSample(): void {
  previousSample = null;
}