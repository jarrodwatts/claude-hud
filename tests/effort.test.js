import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEffortLevel } from '../dist/effort.js';

test('resolveEffortLevel maps stdin levels to symbols', () => {
  assert.deepEqual(resolveEffortLevel({ level: 'HIGH ' }), { level: 'high', symbol: '◑' });
  assert.deepEqual(resolveEffortLevel({ level: 'max' }), { level: 'max', symbol: '●' });
  assert.deepEqual(resolveEffortLevel({ level: 'turbo' }), { level: 'turbo', symbol: '' });
  for (const effort of [undefined, null, {}, { level: '' }, { level: 7 }]) {
    assert.equal(resolveEffortLevel(effort), null);
  }
});

test('resolveEffortLevel wraps the reported level while ultracode is active', () => {
  assert.deepEqual(resolveEffortLevel({ level: 'xhigh' }, true), { level: 'ultracode(xhigh)', symbol: '◕' });
  assert.deepEqual(resolveEffortLevel({ level: 'xhigh' }, false), { level: 'xhigh', symbol: '◕' });
});

test('resolveEffortLevel strips terminal escapes from the level', () => {
  assert.equal(resolveEffortLevel({ level: '\x1b[31mhigh\x1b[0m' })?.level, 'high');
});
