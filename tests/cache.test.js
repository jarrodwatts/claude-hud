import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readCache, writeCache } from '../dist/cache.js';

describe('cache', () => {
  let cacheDir;

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-cache-test-'));
  });

  afterEach(() => {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  it('returns null for missing cache', () => {
    const result = readCache('test-key', 1000, cacheDir);
    assert.strictEqual(result, null);
  });

  it('writes and reads cache within TTL', () => {
    writeCache('test-key', { foo: 'bar' }, cacheDir);
    const result = readCache('test-key', 5000, cacheDir);
    assert.deepStrictEqual(result, { foo: 'bar' });
  });

  it('returns null for expired cache', () => {
    writeCache('test-key', { foo: 'bar' }, cacheDir);
    const cacheFile = path.join(cacheDir, 'cache.json');
    const data = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
    data['test-key'].timestamp = Date.now() - 10000;
    fs.writeFileSync(cacheFile, JSON.stringify(data));
    const result = readCache('test-key', 5000, cacheDir);
    assert.strictEqual(result, null);
  });

  it('stores multiple keys in single file', () => {
    writeCache('key-a', 'value-a', cacheDir);
    writeCache('key-b', 'value-b', cacheDir);
    assert.strictEqual(readCache('key-a', 5000, cacheDir), 'value-a');
    assert.strictEqual(readCache('key-b', 5000, cacheDir), 'value-b');
  });

  it('invalidates by mtime when provided', () => {
    writeCache('mtime-key', 'data', cacheDir, 12345);
    assert.strictEqual(readCache('mtime-key', 5000, cacheDir, 12345), 'data');
    assert.strictEqual(readCache('mtime-key', 5000, cacheDir, 99999), null);
  });
});
