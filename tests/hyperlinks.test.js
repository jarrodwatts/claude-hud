import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeHyperlink } from '../dist/utils/hyperlinks.js';

const link = (url, text) => `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;

function onPlatform(platform, fn) {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { ...original, value: platform });
  try {
    fn();
  } finally {
    Object.defineProperty(process, 'platform', original);
  }
}

test('file: links keep non-ASCII raw on Windows, where %XX decodes with the ANSI code page', () => {
  onPlatform('win32', () => {
    assert.equal(
      safeHyperlink('file:///D:/%E6%A1%8C%E9%9D%A2/a%20b%23%25E6', 'x'),
      link('file:///D:/桌面/a%20b%23%25E6', 'x'),
    );
    assert.equal(safeHyperlink('file:///D:/a%C2%9Bb%E2%80%AEc', 'x'), link('file:///D:/abc', 'x'), 'decoded controls and bidi are stripped');
    assert.equal(safeHyperlink('https://example.com/%E6%A1%8C', 'x'), link('https://example.com/%E6%A1%8C', 'x'));
  });
});

test('file: links stay percent-encoded off Windows', () => {
  onPlatform('linux', () => {
    assert.equal(safeHyperlink('file:///home/u/%E6%A1%8C', 'x'), link('file:///home/u/%E6%A1%8C', 'x'));
  });
});
