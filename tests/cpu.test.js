import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { parseCpuSamples, readCpu } from '../src/cpu.ts';
import { cpuLine } from '../src/render/lines.ts';
import { createFrame } from '../src/render/frame.ts';
import { mergeConfig } from '../src/config.ts';

const cpu = (usedPercent, numCores) => ({ usedPercent, numCores });

test('parseCpuSamples returns a utilization percentage between two samples', () => {
  const a = { user: 100, sys: 50, idle: 850 };
  const b = { user: 150, sys: 60, idle: 890 }; // +50 user, +10 sys, +40 idle over 100 ticks = 60% used
  assert.equal(parseCpuSamples([a, b]), 60);
});

test('parseCpuSamples returns null when the window is too short to trust', () => {
  assert.equal(parseCpuSamples([{ user: 0, sys: 0, idle: 0 }, { user: 0, sys: 0, idle: 0 }]), null);
  assert.equal(parseCpuSamples([{ user: 1, sys: 1, idle: 1 }, { user: 1, sys: 1, idle: 1 }]), null);
  assert.equal(parseCpuSamples([{ user: NaN, sys: 0, idle: 0 }, { user: 1, sys: 0, idle: 0 }]), null);
});

test('readCpu parses a probe answer and ignores malformed input', () => {
  assert.equal(readCpu({ cpuSamples: [{ user: 100, sys: 50, idle: 850 }, { user: 150, sys: 60, idle: 890 }], cores: 8 }), 60);
  assert.equal(readCpu(null), null);
  assert.equal(readCpu({}), null);
  assert.equal(readCpu({ cpuSamples: [{ user: 1, sys: 1, idle: 1 }] }), null);
  assert.equal(readCpu({ cpuSamples: [{ user: 100, sys: 50, idle: 850 }, { user: 150, sys: 60, idle: 890 }] }), null); // missing cores
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
