import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  _resetTerminalWidthCacheForTests,
  _setTtyWidthProbeDepsForTests,
  getAdaptiveBarWidth,
  getTerminalWidth,
} from '../dist/utils/terminal.js';

describe('getAdaptiveBarWidth', () => {
  let originalStdoutColumns;
  let originalStderrColumns;
  let originalEnvColumns;
  let originalDisableTtyWidth;

  beforeEach(() => {
    originalStdoutColumns = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
    originalStderrColumns = Object.getOwnPropertyDescriptor(process.stderr, 'columns');
    originalEnvColumns = process.env.COLUMNS;
    originalDisableTtyWidth = process.env.CLAUDE_HUD_DISABLE_TTY_WIDTH;
    delete process.env.COLUMNS;
    process.env.CLAUDE_HUD_DISABLE_TTY_WIDTH = '1';
    _resetTerminalWidthCacheForTests();
  });

  afterEach(() => {
    _setTtyWidthProbeDepsForTests(null);
    _resetTerminalWidthCacheForTests();
    if (originalStdoutColumns) {
      Object.defineProperty(process.stdout, 'columns', originalStdoutColumns);
    } else {
      delete process.stdout.columns;
    }
    if (originalStderrColumns) {
      Object.defineProperty(process.stderr, 'columns', originalStderrColumns);
    } else {
      delete process.stderr.columns;
    }
    if (originalEnvColumns !== undefined) {
      process.env.COLUMNS = originalEnvColumns;
    } else {
      delete process.env.COLUMNS;
    }
    if (originalDisableTtyWidth !== undefined) {
      process.env.CLAUDE_HUD_DISABLE_TTY_WIDTH = originalDisableTtyWidth;
    } else {
      delete process.env.CLAUDE_HUD_DISABLE_TTY_WIDTH;
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

  test('treats COLUMNS env var as a hard override when present', () => {
    Object.defineProperty(process.stdout, 'columns', { value: 120, configurable: true });
    process.env.COLUMNS = '70';
    assert.equal(getAdaptiveBarWidth(), 6);
  });

  test('falls back to COLUMNS env var when stdout.columns unavailable', () => {
    Object.defineProperty(process.stdout, 'columns', { value: undefined, configurable: true });
    process.env.COLUMNS = '70';
    assert.equal(getAdaptiveBarWidth(), 6);
  });

  test('falls back to stderr.columns when stdout.columns and COLUMNS are unavailable', () => {
    Object.defineProperty(process.stdout, 'columns', { value: undefined, configurable: true });
    Object.defineProperty(process.stderr, 'columns', { value: 70, configurable: true });
    delete process.env.COLUMNS;
    assert.equal(getAdaptiveBarWidth(), 6);
  });

  test('returns 10 when stdout.columns, stderr.columns, and COLUMNS are unavailable', () => {
    Object.defineProperty(process.stdout, 'columns', { value: undefined, configurable: true });
    Object.defineProperty(process.stderr, 'columns', { value: undefined, configurable: true });
    delete process.env.COLUMNS;
    assert.equal(getAdaptiveBarWidth(), 10);
  });

  test('falls back to cached controlling terminal columns when streams are unavailable', () => {
    let openCalls = 0;
    let destroyCalls = 0;
    let closeCalls = 0;
    Object.defineProperty(process.stdout, 'columns', { value: undefined, configurable: true });
    Object.defineProperty(process.stderr, 'columns', { value: undefined, configurable: true });
    delete process.env.COLUMNS;
    delete process.env.CLAUDE_HUD_DISABLE_TTY_WIDTH;
    _setTtyWidthProbeDepsForTests({
      openSync(path, flags) {
        openCalls += 1;
        assert.equal(path, '/dev/tty');
        assert.equal(flags, 'r+');
        return 42;
      },
      createWriteStream(fd) {
        assert.equal(fd, 42);
        return {
          columns: 88,
          destroy() {
            destroyCalls += 1;
          },
        };
      },
      closeSync() {
        closeCalls += 1;
      },
    });

    assert.equal(getTerminalWidth(), 88);
    assert.equal(getAdaptiveBarWidth(), 6);
    assert.equal(getTerminalWidth({ preferEnv: true }), 88);
    assert.equal(openCalls, 1, 'tty should be opened once per process');
    assert.equal(destroyCalls, 1, 'constructed tty stream should be destroyed once');
    assert.equal(closeCalls, 0, 'constructed tty stream owns the fd');
  });

  test('falls back and caches null when controlling terminal is unavailable', () => {
    let openCalls = 0;
    Object.defineProperty(process.stdout, 'columns', { value: undefined, configurable: true });
    Object.defineProperty(process.stderr, 'columns', { value: undefined, configurable: true });
    delete process.env.COLUMNS;
    delete process.env.CLAUDE_HUD_DISABLE_TTY_WIDTH;
    _setTtyWidthProbeDepsForTests({
      openSync() {
        openCalls += 1;
        throw new Error('no controlling terminal');
      },
    });

    assert.equal(getTerminalWidth({ fallback: 72 }), 72);
    assert.equal(getTerminalWidth({ fallback: 80 }), 80);
    assert.equal(openCalls, 1, 'unavailable tty should not be reprobed in the same process');
  });

  test('closes the fd when tty stream construction fails', () => {
    let closeCalls = 0;
    Object.defineProperty(process.stdout, 'columns', { value: undefined, configurable: true });
    Object.defineProperty(process.stderr, 'columns', { value: undefined, configurable: true });
    delete process.env.COLUMNS;
    delete process.env.CLAUDE_HUD_DISABLE_TTY_WIDTH;
    _setTtyWidthProbeDepsForTests({
      openSync() {
        return 43;
      },
      createWriteStream() {
        throw new Error('constructor failed');
      },
      closeSync(fd) {
        closeCalls += 1;
        assert.equal(fd, 43);
      },
    });

    assert.equal(getTerminalWidth({ fallback: 90 }), 90);
    assert.equal(closeCalls, 1);
  });
});
