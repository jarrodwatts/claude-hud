import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _setDiskReaderForTests, getDiskUsage, parseDfOutput } from '../dist/disk.js';

test('getDiskUsage derives used bytes from total minus available', async () => {
  _setDiskReaderForTests(() => ({
    totalBytes: 500 * 1024 ** 3,
    freeBytes: 100 * 1024 ** 3,
  }));

  const diskUsage = await getDiskUsage('/tmp');

  assert.deepEqual(diskUsage, {
    path: '/tmp',
    totalBytes: 500 * 1024 ** 3,
    usedBytes: 400 * 1024 ** 3,
    freeBytes: 100 * 1024 ** 3,
    usedPercent: 80,
  });
});

test('getDiskUsage clamps free space that exceeds the volume size', async () => {
  _setDiskReaderForTests(() => ({
    totalBytes: 10 * 1024 ** 3,
    freeBytes: 40 * 1024 ** 3,
  }));

  const diskUsage = await getDiskUsage('/tmp');

  assert.equal(diskUsage.usedBytes, 0);
  assert.equal(diskUsage.usedPercent, 0);
});

test('getDiskUsage falls back to the next candidate path', async () => {
  _setDiskReaderForTests((path) =>
    path === '/'
      ? { totalBytes: 1024 ** 3, freeBytes: 512 * 1024 ** 2 }
      : null,
  );

  const diskUsage = await getDiskUsage('/nope');

  assert.equal(diskUsage.path, '/');
  assert.equal(diskUsage.usedPercent, 50);
});

test('getDiskUsage returns null when every candidate fails', async () => {
  _setDiskReaderForTests(() => null);

  assert.equal(await getDiskUsage('/tmp'), null);
});

test('getDiskUsage returns null for a zero-sized filesystem', async () => {
  _setDiskReaderForTests(() => ({ totalBytes: 0, freeBytes: 0 }));

  assert.equal(await getDiskUsage('/tmp'), null);
});

test('parseDfOutput reads the total and available columns', () => {
  const output = `Filesystem 1024-blocks      Used Available Capacity Mounted on
/dev/disk3s1s1  482797652  12275212  94767308      12% /`;

  assert.deepEqual(parseDfOutput(output), {
    totalBytes: 482797652 * 1024,
    freeBytes: 94767308 * 1024,
  });
});

test('parseDfOutput returns null for unusable output', () => {
  assert.equal(parseDfOutput(''), null);
  assert.equal(parseDfOutput('Filesystem 1024-blocks Used Available Capacity Mounted on'), null);
  assert.equal(parseDfOutput('Filesystem 1024-blocks\n/dev/disk3s1s1 abc'), null);
});

test.after(() => {
  _setDiskReaderForTests(null);
});
