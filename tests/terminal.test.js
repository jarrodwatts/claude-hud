import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { getTerminalWidth } from '../dist/utils/terminal.js';

let saved;

beforeEach(() => {
  saved = {
    stdout: Object.getOwnPropertyDescriptor(process.stdout, 'columns'),
    stderr: Object.getOwnPropertyDescriptor(process.stderr, 'columns'),
    env: process.env.COLUMNS,
  };
  delete process.env.COLUMNS;
});

afterEach(() => {
  for (const [stream, descriptor] of [[process.stdout, saved.stdout], [process.stderr, saved.stderr]]) {
    if (descriptor) Object.defineProperty(stream, 'columns', descriptor);
    else delete stream.columns;
  }
  if (saved.env === undefined) delete process.env.COLUMNS;
  else process.env.COLUMNS = saved.env;
});

const setColumns = (stream, value) => Object.defineProperty(stream, 'columns', { value, configurable: true });

test('getTerminalWidth prefers COLUMNS, then stdout, then stderr', () => {
  setColumns(process.stdout, 120);
  setColumns(process.stderr, 90);
  process.env.COLUMNS = '70';
  assert.equal(getTerminalWidth(), 70);
  delete process.env.COLUMNS;
  assert.equal(getTerminalWidth(), 120);
  setColumns(process.stdout, undefined);
  assert.equal(getTerminalWidth(), 90);
  setColumns(process.stderr, undefined);
  assert.equal(getTerminalWidth(), null);
});

test('getTerminalWidth ignores invalid values and caps hostile widths', () => {
  setColumns(process.stdout, undefined);
  setColumns(process.stderr, undefined);
  for (const value of ['', 'abc', '0', '-5']) {
    process.env.COLUMNS = value;
    assert.equal(getTerminalWidth(), null, value);
  }
  process.env.COLUMNS = '600000000';
  assert.equal(getTerminalWidth(), 1000);
});
