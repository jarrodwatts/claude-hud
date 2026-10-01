import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_CONFIG } from '../dist/config.js';

const readme = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const documented = (markdown) => [...markdown.matchAll(/^\| `([A-Za-z][\w.]+)` \|/gm)].map((match) => match[1]).sort();

function configKeys(value, prefix = '') {
  return Object.entries(value).flatMap(([key, child]) =>
    child !== null && typeof child === 'object' && !Array.isArray(child)
      ? configKeys(child, `${prefix}${key}.`)
      : [`${prefix}${key}`]);
}

test('both READMEs document exactly the config keys', () => {
  const keys = configKeys(DEFAULT_CONFIG).sort();
  assert.deepEqual(documented(readme('README.md')), keys);
  assert.deepEqual(documented(readme('README.zh.md')), keys);
});
