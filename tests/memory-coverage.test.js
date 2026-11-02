import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes, getMemoryUsage, parseLinuxMeminfo, parseVmStat } from '../src/memory.ts';

test('getMemoryUsage returns null when totalBytes is zero', async () => {
  const result = getMemoryUsage({
    totalBytes: 0,
    freeBytes: 0,
  });
  assert.equal(result, null);
});

test('getMemoryUsage returns null when totalBytes is negative', async () => {
  const result = getMemoryUsage({
    totalBytes: -1,
    freeBytes: 0,
  });
  assert.equal(result, null);
});

test('getMemoryUsage returns null when totalBytes is non-finite', async () => {
  const result = getMemoryUsage({
    totalBytes: Infinity,
    freeBytes: 1000,
  });
  assert.equal(result, null);
});

test('getMemoryUsage treats non-finite freeBytes as 0', async () => {
  const result = getMemoryUsage({
    totalBytes: 8 * 1024 ** 3,
    freeBytes: NaN,
  });
  assert.equal(result.usedPercent, 100);
  assert.equal(result.freeBytes, 0);
  assert.equal(result.usedBytes, 8 * 1024 ** 3);
});

test('getMemoryUsage clamps negative freeBytes to 0', async () => {
  const result = getMemoryUsage({
    totalBytes: 16 * 1024 ** 3,
    freeBytes: -500,
  });
  assert.equal(result.freeBytes, 0);
  assert.equal(result.usedPercent, 100);
});

test('getMemoryUsage calculates correct percentages for normal values', async () => {
  const result = getMemoryUsage({
    totalBytes: 16 * 1024 ** 3,
    freeBytes: 8 * 1024 ** 3,
  });
  assert.equal(result.usedPercent, 50);
  assert.equal(result.usedBytes, 8 * 1024 ** 3);
  assert.equal(result.freeBytes, 8 * 1024 ** 3);
  assert.equal(result.totalBytes, 16 * 1024 ** 3);
});

test('getMemoryUsage clamps usedPercent between 0 and 100', async () => {
  // freeBytes larger than totalBytes → clamp free to total → used = 0
  const result = getMemoryUsage({
    totalBytes: 4 * 1024 ** 3,
    freeBytes: 5 * 1024 ** 3,
  });
  assert.equal(result.usedPercent, 0);
  assert.equal(result.freeBytes, 4 * 1024 ** 3);
});

test('parseVmStat returns null when page size is present but active pages are missing', () => {
  const output = `Mach Virtual Memory Statistics: (page size of 4096 bytes)
Pages free:                             500000.
Pages wired down:                        100000.`;
  assert.equal(parseVmStat(output), null);
});

test('parseVmStat returns null when wired pages are missing', () => {
  const output = `Mach Virtual Memory Statistics: (page size of 4096 bytes)
Pages free:                             500000.
Pages active:                            100000.`;
  assert.equal(parseVmStat(output), null);
});

test('parseLinuxMeminfo returns valid result for very large finite values', () => {
  // These values are large but still finite in JS
  const output = `MemTotal:       99999999999999999999999999999999999 kB
MemAvailable:   99999999999999999999999999999999999 kB`;
  const result = parseLinuxMeminfo(output);
  // Number() of these large values is finite (1.024e+38), so it parses successfully
  assert.ok(result !== null);
  assert.ok(Number.isFinite(result.totalBytes));
});

test('parseLinuxMeminfo returns null when MemTotal is missing', () => {
  const output = `MemAvailable:   18290212 kB`;
  assert.equal(parseLinuxMeminfo(output), null);
});

test('formatBytes handles edge cases', () => {
  assert.equal(formatBytes(-100), '0 B');
  assert.equal(formatBytes(NaN), '0 B');
  assert.equal(formatBytes(Infinity), '0 B');
  assert.equal(formatBytes(1023), '1023 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(1024 * 1024), '1.0 MB');
  assert.equal(formatBytes(1024 ** 4), '1.0 TB');
  assert.equal(formatBytes(5.5 * 1024), '5.5 KB');
  assert.equal(formatBytes(15 * 1024), '15 KB');
});
