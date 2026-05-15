import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _setMemoryReaderForTests, formatBytes, getMemoryUsage, parseLinuxMeminfo, parseVmStat } from '../dist/memory.js';

test('getMemoryUsage returns coarse system RAM usage with clamped values', async () => {
  _setMemoryReaderForTests(() => ({
    totalBytes: 16 * 1024 ** 3,
    freeBytes: 20 * 1024 ** 3,
  }));

  const memoryUsage = await getMemoryUsage();

  assert.deepEqual(memoryUsage, {
    totalBytes: 16 * 1024 ** 3,
    usedBytes: 0,
    freeBytes: 16 * 1024 ** 3,
    usedPercent: 0,
  });
});

test('getMemoryUsage returns null when memory lookup fails', async () => {
  _setMemoryReaderForTests(() => {
    throw new Error('boom');
  });

  const memoryUsage = await getMemoryUsage();

  assert.equal(memoryUsage, null);
});

test('parseVmStat parses vm_stat output correctly', () => {
  const output = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                             2588951.
Pages active:                            253775.
Pages inactive:                          246498.
Pages speculative:                        35498.
Pages throttled:                              0.
Pages wired down:                        195488.
Pages purgeable:                          14994.
"Translation faults":                 894498389.
Pages copy-on-write:                   26696671.
Pages zero filled:                    416498538.
Pages reactivated:                     13299498.
Pages purged:                           5765498.
File-backed pages:                       156498.
Anonymous pages:                         343775.
Pages stored in compressor:              498775.
Pages occupied by compressor:            115488.
Decompressions:                        42498775.
Compressions:                          58498775.
Pageins:                               84498775.
Pageouts:                               1498775.
Swapins:                                      0.
Swapouts:                                     0.`;
  const result = parseVmStat(output);
  assert.deepEqual(result, { pageSize: 16384, active: 253775, wired: 195488, compressor: 115488 });
});

test('parseVmStat returns null for empty string', () => {
  assert.equal(parseVmStat(''), null);
});

test('parseVmStat returns null for malformed output', () => {
  assert.equal(parseVmStat('not valid vm_stat output'), null);
});

test('parseVmStat treats missing compressor line as 0 (pre-10.9 / stripped output)', () => {
  const output = `Mach Virtual Memory Statistics: (page size of 4096 bytes)
Pages free:                              100000.
Pages active:                            200000.
Pages inactive:                          150000.
Pages wired down:                         50000.`;
  const result = parseVmStat(output);
  assert.deepEqual(result, { pageSize: 4096, active: 200000, wired: 50000, compressor: 0 });
});

test('parseLinuxMeminfo uses MemAvailable for Linux free memory', () => {
  const output = `MemTotal:       31982940 kB
MemFree:         7105992 kB
MemAvailable:   18290212 kB
Buffers:          372008 kB`;

  assert.deepEqual(parseLinuxMeminfo(output), {
    totalBytes: 31982940 * 1024,
    freeBytes: 18290212 * 1024,
  });
});

test('parseLinuxMeminfo returns null without MemAvailable', () => {
  const output = `MemTotal:       31982940 kB
MemFree:         7105992 kB`;

  assert.equal(parseLinuxMeminfo(output), null);
});

test('macOS memory calculation: 16GB total, active+wired+compressor via vm_stat → 54%', async () => {
  const totalBytes = 16 * 1024 ** 3;
  // Mirrors readMacOSMemory: usedBytes = (active + wired + compressor) * pageSize.
  // Without the compressor pages, this same fixture reports 43% — the gap
  // shows up as the difference between claude-hud and Activity Monitor on
  // pressured macOS systems before this fix.
  const usedBytes = (253775 + 195488 + 115488) * 16384;
  _setMemoryReaderForTests(() => ({
    totalBytes,
    freeBytes: totalBytes - usedBytes,
  }));

  const memoryUsage = await getMemoryUsage();
  assert.equal(memoryUsage.usedPercent, 54);
  assert.equal(memoryUsage.usedBytes, usedBytes);
});

test('formatBytes formats human-readable units for memory line display', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(10 * 1024 ** 3), '10 GB');
});

test.after(() => {
  _setMemoryReaderForTests(null);
});
