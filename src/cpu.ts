type RawCpu = { user: number; sys: number; idle: number };

/** The `cpu` probe's answer: two `os.cpus()` tick samples taken ~100 ms apart and the core count. */
export type CpuFacts = { cpuSamples: [RawCpu, RawCpu]; cores: number } | null | undefined;

/**
 * Convert two tick samples into a utilization percentage. Returns null when the window is too
 * short to trust (e.g. the first render after a long idle), so callers show nothing rather
 * than a meaningless number.
 */
export function parseCpuSamples(samples: [RawCpu, RawCpu]): number | null {
  const [a, b] = samples;
  const totalDiff = (b.user + b.sys + b.idle) - (a.user + a.sys + a.idle);
  const usedDiff = (b.user + b.sys) - (a.user + a.sys);
  if (totalDiff <= 0 || !Number.isFinite(totalDiff) || !Number.isFinite(usedDiff)) return null;
  return Math.round((usedDiff / totalDiff) * 100);
}

/** Read the CPU facts from the probe answer, and parse to a utilization percentage. */
export function readCpu(facts: CpuFacts): number | null {
  if (!facts?.cpuSamples || facts.cpuSamples.length < 2 || typeof facts.cores !== 'number') return null;
  return parseCpuSamples(facts.cpuSamples);
}
