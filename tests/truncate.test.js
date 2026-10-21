import { test } from 'node:test';
import assert from 'node:assert/strict';
import { truncateString } from '../dist/utils/truncate.js';

for (const [name, text, maxLen, suffix, expected] of [
  ['null', null, 5, undefined, ''],
  ['undefined', undefined, 5, undefined, ''],
  ['empty text', '', 0, undefined, ''],
  ['text below the limit', 'hello', 6, undefined, 'hello'],
  ['text at the limit', 'hello', 5, undefined, 'hello'],
  ['ASCII truncation', 'hello world', 8, undefined, 'hello...'],
  ['custom suffix', 'hello world', 8, '…', 'hello w…'],
  ['empty suffix', 'hello world', 5, '', 'hello'],
  ['budget below suffix length', 'hello', 2, undefined, '...'],
  ['zero budget', 'hello', 0, undefined, '...'],
  ['negative budget', 'hello', -1, undefined, '...'],
  ['emoji at the limit', 'a😀', 3, undefined, 'a😀'],
  ['split surrogate pair', 'a'.repeat(46) + '😀tail', 50, undefined, 'a'.repeat(46) + '...'],
  ['whole emoji fits', 'a😀tail', 6, undefined, 'a😀...'],
  ['split ZWJ sequence', 'a👩‍💻tail', 7, undefined, 'a...'],
  ['whole ZWJ sequence fits', 'a👩‍💻tail', 9, undefined, 'a👩‍💻...'],
  ['split combining sequence', 'ae\u0301tail', 5, undefined, 'a...'],
  ['whole combining sequence fits', 'ae\u0301tail', 6, undefined, 'ae\u0301...'],
]) {
  test(`truncateString preserves its length budget and graphemes: ${name}`, () => {
    assert.equal(truncateString(text, maxLen, suffix), expected);
  });
}
