import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { separatorLine, textWidth, visibleWidth, wrapToWidth } from '../dist/render/ansi.js';
import { setLanguage } from '../dist/i18n/index.js';

const RESET = '\x1b[0m';
const link = (url, text, end = '\x1b\\') => `\x1b]8;;${url}${end}${text}\x1b]8;;${end}`;
const plain = (s) => s.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');

afterEach(() => setLanguage('en'));

test('visibleWidth skips CSI and OSC 8 sequences with either terminator', () => {
  assert.equal(visibleWidth('\x1b[31mred\x1b[0m'), 3);
  assert.equal(visibleWidth(link('https://example.com', 'docs')), 4);
  assert.equal(visibleWidth(link('https://example.com', 'docs', '\x07')), 4);
  assert.equal(visibleWidth('a\x1bb'), 2, 'a lone ESC swallows nothing after it');
});

test('textWidth counts wide, emoji, and zero-width characters by cell', () => {
  assert.equal(textWidth('abc'), 3);
  assert.equal(textWidth('上下文'), 6);
  assert.equal(textWidth('한국'), 4);
  assert.equal(textWidth('🔥'), 2);
  assert.equal(textWidth('👩‍💻'), 2, 'a ZWJ sequence is one glyph');
  assert.equal(textWidth('❤️'), 2, 'VS16 makes a text symbol an emoji');
  assert.equal(textWidth('é'), 1, 'combining marks take no cell');
  assert.equal(textWidth('a︎'), 1);
});

test('ambiguous-width symbols are two cells only in a CJK language', () => {
  assert.equal(textWidth('█│─▲'), 4);
  setLanguage('zh-Hans');
  assert.equal(textWidth('█│─▲'), 8);
  assert.equal(textWidth('abc'), 3);
});

test('wrapToWidth leaves fitting lines and unknown widths alone', () => {
  const line = 'Context 45% │ Usage 25%';
  assert.deepEqual(wrapToWidth(line, 80), [line]);
  assert.deepEqual(wrapToWidth(line, 0), [line]);
  assert.deepEqual(wrapToWidth('x'.repeat(500), 0), ['x'.repeat(500)]);
});

test('wrapToWidth breaks at either separator, keeping each part whole', () => {
  const line = `\x1b[2mContext\x1b[0m 45% │ \x1b[2mUsage\x1b[0m 25% (resets in 1h) | Weekly 85%`;
  const lines = wrapToWidth(line, 32);
  assert.deepEqual(lines.map(plain), ['Context 45%', 'Usage 25% (resets in 1h)', 'Weekly 85%']);
  assert.deepEqual(wrapToWidth('a | b | c | d', 5), ['a | b', 'c | d']);
});

test('wrapToWidth keeps a leading [model | provider] badge on one line', () => {
  const badge = '\x1b[36m[Opus 5.5 | Bedrock]\x1b[0m';
  assert.deepEqual(wrapToWidth(`${badge} │ my-project | extra`, 22).map(plain), ['[Opus 5.5 | Bedrock]', 'my-project | extra']);
});

test('separators inside escape sequences are not break points', () => {
  const line = `${link('https://example.com/a | b', 'linked')} | next`;
  assert.deepEqual(wrapToWidth(line, 8).map(plain), ['linked', 'next']);
});

test('an unbreakable part is truncated with an ellipsis and a reset', () => {
  const [line] = wrapToWidth(`\x1b[33m${'x'.repeat(30)}\x1b[0m`, 10);
  assert.equal(plain(line), 'xxxxxxx...');
  assert.ok(line.endsWith(RESET));
  assert.equal(plain(wrapToWidth('abcdef', 2)[0]), '..');
});

test('truncation never splits a wide character', () => {
  const [line] = wrapToWidth('上下文窗口已满', 8);
  assert.equal(plain(line), '上下...');
  assert.equal(visibleWidth(line), 7);
});

test('truncation inside an OSC 8 link closes it, for either terminator', () => {
  for (const end of ['\x1b\\', '\x07']) {
    const [line] = wrapToWidth(link('file:///home/u/project', 'a-very-long-project-name', end), 12);
    assert.equal(plain(line), 'a-very-lo...');
    const close = line.indexOf('\x1b]8;;\x1b\\', line.indexOf('a-very'));
    assert.ok(close !== -1 && close < line.indexOf('...'), 'the link closes before the ellipsis');
  }
  const [closed] = wrapToWidth(`${link('file:///x', 'ab')}${'c'.repeat(20)}`, 10);
  assert.equal(closed.split('\x1b]8;;').length, 3, 'a link already closed is not closed again');
});

test('wrapping is linear in the line length', () => {
  const part = `\x1b[32m${'█'.repeat(8)}\x1b[0m ${link('https://example.com', 'segment')}`;
  const line = Array.from({ length: 2000 }, () => part).join(' | ');
  const started = performance.now();
  const lines = wrapToWidth(line, 80);
  assert.ok(performance.now() - started < 2000);
  assert.equal(lines.length, 500);
});

test('separatorLine fills the width, with half as many dashes in CJK terminals', () => {
  assert.equal(plain(separatorLine(30)), '─'.repeat(30));
  assert.equal(plain(separatorLine(0)), '─');
  setLanguage('zh-Hans');
  assert.equal(plain(separatorLine(30)), '─'.repeat(15));
  assert.equal(textWidth(plain(separatorLine(31))), 30);
});
