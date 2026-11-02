import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runMatrix } from './escape/run.mjs';

test('caged logic is denied every case in the escape matrix', async (t) => {
  const { lines, connections } = await runMatrix();
  for (const line of lines) t.diagnostic(line);
  assert.equal(lines.length, 35, 'every case reported');
  assert.deepEqual(lines.filter((line) => !line.startsWith('blocked ')), []);
  assert.equal(connections, 0, 'nothing reached the listener');
});
