import assert from 'node:assert/strict';
import test from 'node:test';

import { getAdaptiveBarWidth, getTerminalWidth } from './terminal.js';

test('prefers COLUMNS env override over process.stdout.columns', () => {
  assert.equal(getTerminalWidth('120', 60), 120);
});

test('falls back to stdout columns when COLUMNS is missing', () => {
  assert.equal(getTerminalWidth(undefined, 72), 72);
});

test('uses wide progress bar when COLUMNS override reports a wide terminal', () => {
  const originalColumns = process.env.COLUMNS;
  process.env.COLUMNS = '120';

  try {
    assert.equal(getAdaptiveBarWidth(), 10);
  } finally {
    if (originalColumns === undefined) {
      delete process.env.COLUMNS;
    } else {
      process.env.COLUMNS = originalColumns;
    }
  }
});
