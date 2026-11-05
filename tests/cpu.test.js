import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { getCpuUsage, parseCpuSamples, readCpu, sampleCpuTimes } from '../src/cpu.ts';
import { cpuLine } from '../src/render/lines.ts';
import { createFrame } from '../src/render/frame.ts';
import { mergeConfig } from '../src/config.ts';

const cpu = (usedPercent, numCores) => ({ usedPercent, numCores });

test('sampleCpuTimes aggregates os.cpus() tick counts', () => {
  const sample = sampleCpuTimes();
  assert.equal(typeof sample.user, 'number');
  assert.equal(typeof sample.sys, 'number');
  assert.equal(typeof sample.idle, 'number');
  assert.ok(sample.user >= 0 && sample.sys >= 0 && sample.idle >= 0);
  // The sum should track the machine's total tick count, which grows monotonically.
  const again = sampleCpuTimes();
  assert.ok(again.user + again.sys + again.idle >= sample.user + sample.sys + sample.idle);
});

test('parseCpuSamples returns a utilization delta between two samples', () => {
  const a = { user: 100, sys: 50, idle: 850 };
  const b = { user: 150, sys: 60, idle: 890 }; // +50 user, +10 sys, +40 idle over 100 ticks = 60% used
  assert.deepEqual(parseCpuSamples([a, b]), { user: 60, sys: 0, idle: 40 });
});

test('parseCpuSamples returns null when the window is too short to trust', () => {
  assert.equal(parseCpuSamples([{ user: 0, sys: 0, idle: 0 }, { user: 0, sys: 0, idle: 0 }]), null);
  assert.equal(parseCpuSamples([{ user: 1, sys: 1, idle: 1 }, { user: 1, sys: 1, idle: 1 }]), null);
  assert.equal(parseCpuSamples([{ user: NaN, sys: 0, idle: 0 }, { user: 1, sys: 0, idle: 0 }]), null);
});

test('readCpu parses a probe answer and ignores malformed input', () => {
  assert.deepEqual(readCpu({ cpuSamples: [{ user: 100, sys: 50, idle: 850 }, { user: 150, sys: 60, idle: 890 }] }), { user: 60, sys: 0, idle: 40 });
  assert.equal(readCpu(null), null);
  assert.equal(readCpu({}), null);
  assert.equal(readCpu({ cpuSamples: [{ user: 1, sys: 1, idle: 1 }] }), null);
});

test('getCpuUsage computes a percentage and core count from a delta', () => {
  assert.deepEqual(getCpuUsage({ user: 60, sys: 0, idle: 40 }), { usedPercent: 60, numCores: os.cpus().length });
  assert.deepEqual(getCpuUsage({ user: 0, sys: 0, idle: 100 }), { usedPercent: 0, numCores: os.cpus().length });
  assert.equal(getCpuUsage({ user: 0, sys: 0, idle: 0 }), null);
});

test('cpuLine renders the bar, colored percentage and core count', () => {
  const config = mergeConfig({ display: { showCpu: true }, lineLayout: 'expanded' });
  const frame = createFrame({ cpuUsage: cpu(72, 8) }, 120, 0);
  frame.config = config;
  const line = cpuLine(frame);
  assert.ok(line, 'expected a CPU line when showCpu is enabled');
  assert.match(line, /72%/);
  assert.match(line, /\(8 cores\)/);
});

test('cpuLine is hidden when showCpu is off or layout is compact', () => {
  const off = mergeConfig({ display: { showCpu: false }, lineLayout: 'expanded' });
  const compact = mergeConfig({ display: { showCpu: true }, lineLayout: 'compact' });
  const frameOff = createFrame({ cpuUsage: cpu(72, 8) }, 120, 0); frameOff.config = off;
  const frameCompact = createFrame({ cpuUsage: cpu(72, 8) }, 120, 0); frameCompact.config = compact;
  assert.equal(cpuLine(frameOff), null);
  assert.equal(cpuLine(frameCompact), null);
});

test('cpuLine is hidden when there is no usable sample', () => {
  const config = mergeConfig({ display: { showCpu: true }, lineLayout: 'expanded' });
  const frame = createFrame({ cpuUsage: null }, 120, 0);
  frame.config = config;
  assert.equal(cpuLine(frame), null);
});