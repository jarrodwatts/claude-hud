import os from 'node:os';

type RawCpu = { user: number; sys: number; idle: number };

/** The `cpu` probe's answer: two `os.cpus()` tick samples taken ~100 ms apart. */
export type CpuFacts = { cpuSamples: [RawCpu, RawCpu] } | null | undefined;

/**
 * Aggregate one `os.cpus()` sample into user/sys/idle tick totals.
 * `os.cpus()` works on every platform (Linux, macOS, Windows) and is far cheaper than `top`.
 */
export function sampleCpuTimes(): RawCpu {
  let user = 0, sys = 0, idle = 0;
  for (const c of os.cpus()) { user += c.times.user; sys += c.times.sys; idle += c.times.idle; }
  return { user, sys, idle };
}

/** Convert two tick samples into a utilization delta. Returns null when the window is too
 *  short to trust (e.g. the first render after a long idle), so callers show nothing rather
 *  than a meaningless number. */
export function parseCpuSamples(samples: [RawCpu, RawCpu]): RawCpu | null {
  const [a, b] = samples;
  const totalDiff = (b.user + b.sys + b.idle) - (a.user + a.sys + a.idle);
  const usedDiff = (b.user + b.sys) - (a.user + a.sys);
  if (totalDiff <= 0 || !Number.isFinite(totalDiff) || !Number.isFinite(usedDiff)) return null;
  return { user: usedDiff, sys: 0, idle: totalDiff - usedDiff };
}

/** Read the CPU facts from the probe answer, and parse to a RawCpu delta. */
export function readCpu(facts: CpuFacts): RawCpu | null {
  if (!facts?.cpuSamples || facts.cpuSamples.length < 2) return null;
  return parseCpuSamples(facts.cpuSamples);
}

/** Compute CPU utilization from a delta sample. Pure: no state, no file I/O, no platform logic. */
export function getCpuUsage(current: RawCpu): { usedPercent: number; numCores: number } | null {
  const numCores = os.cpus().length;
  const total = current.user + current.sys + current.idle;
  if (total <= 0 || !Number.isFinite(total)) return null;
  const usedPercent = Math.round((current.user / total) * 100);
  return { usedPercent, numCores };
}