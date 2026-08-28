import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function tableOptionKeys(markdown) {
  return [...markdown.matchAll(/^\| `([A-Za-z][\w.]+)` \|/gm)].map((match) => match[1]);
}

test('README.zh.md documents every English options-table key', () => {
  const en = tableOptionKeys(readFileSync(join(root, 'README.md'), 'utf8'));
  const zh = tableOptionKeys(readFileSync(join(root, 'README.zh.md'), 'utf8'));
  assert.deepEqual([...new Set(zh)].sort(), [...new Set(en)].sort());
});

test('README.zh.md states that externalUsagePath must be absolute', () => {
  const zh = readFileSync(join(root, 'README.zh.md'), 'utf8');
  const row = zh.split('\n').find((line) => line.includes('`display.externalUsagePath`'));
  assert.ok(row, 'expected an externalUsagePath row');
  assert.match(row, /绝对路径/);
});
