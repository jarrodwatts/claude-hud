import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { getAdaptiveBarWidth } from '../dist/utils/terminal.js';

describe('getAdaptiveBarWidth', () => {
  let originalColumns;
  let originalEnvColumns;

  beforeEach(() => {
    originalColumns = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
    originalEnvColumns = process.env.COLUMNS;
    delete process.env.COLUMNS;
  });

  afterEach(() => {
    if (originalColumns) {
      Object.defineProperty(process.stdout, 'columns', originalColumns);
    } else {
      delete process.stdout.columns;
    }
    if (originalEnvColumns !== undefined) {
      process.env.COLUMNS = originalEnvColumns;
    } else {
      delete process.env.COLUMNS;
    }
  });

  test('returns 4 for narrow terminal (<60 cols)', () => {
    Object.defineProperty(process.stdout, 'columns', { value: 40, configurable: true });
    assert.equal(getAdaptiveBarWidth(), 4);
  });

  test('returns 4 for exactly 59 cols', () => {
    Object.defineProperty(process.stdout, 'columns', { value: 59, configurable: true });
    assert.equal(getAdaptiveBarWidth(), 4);
  });

  test('returns 6 for medium terminal (60-99 cols)', () => {
    Object.defineProperty(process.stdout, 'columns', { value: 70, configurable: true });
    assert.equal(getAdaptiveBarWidth(), 6);
  });

  test('returns 6 for exactly 60 cols', () => {
    Object.defineProperty(process.stdout, 'columns', { value: 60, configurable: true });
    assert.equal(getAdaptiveBarWidth(), 6);
  });

  test('returns 6 for exactly 99 cols', () => {
    Object.defineProperty(process.stdout, 'columns', { value: 99, configurable: true });
    assert.equal(getAdaptiveBarWidth(), 6);
  });

  test('returns 10 for wide terminal (>=100 cols)', () => {
    Object.defineProperty(process.stdout, 'columns', { value: 120, configurable: true });
    assert.equal(getAdaptiveBarWidth(), 10);
  });

  test('returns 10 for exactly 100 cols', () => {
    Object.defineProperty(process.stdout, 'columns', { value: 100, configurable: true });
    assert.equal(getAdaptiveBarWidth(), 10);
  });

  test('returns 10 when stdout.columns is undefined (non-TTY/piped)', () => {
    Object.defineProperty(process.stdout, 'columns', { value: undefined, configurable: true });
    assert.equal(getAdaptiveBarWidth(), 10);
  });

  test('falls back to COLUMNS env var when stdout.columns unavailable', () => {
    Object.defineProperty(process.stdout, 'columns', { value: undefined, configurable: true });
    process.env.COLUMNS = '70';
    assert.equal(getAdaptiveBarWidth(), 6);
  });

  test('returns 10 when both stdout.columns and COLUMNS are unavailable', () => {
    Object.defineProperty(process.stdout, 'columns', { value: undefined, configurable: true });
    delete process.env.COLUMNS;
    assert.equal(getAdaptiveBarWidth(), 10);
  });
});
