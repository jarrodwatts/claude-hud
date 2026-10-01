import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { isCjkLanguage, setLanguage, t } from '../dist/i18n/index.js';
import { en } from '../dist/i18n/en.js';
import { zhHans } from '../dist/i18n/zh-Hans.js';
import { zhHant } from '../dist/i18n/zh-Hant.js';

afterEach(() => setLanguage('en'));

test('both Chinese locales define every English message key', () => {
  const keys = Object.keys(en).sort();
  assert.deepEqual(Object.keys(zhHans).sort(), keys);
  assert.deepEqual(Object.keys(zhHant).sort(), keys);
});

test('t() follows the language, with zh and zh-TW as aliases', () => {
  assert.equal(t('label.approxRam'), 'Approx RAM');
  for (const [language, expected] of [['zh', '内存'], ['zh-Hans', '内存'], ['zh-Hant', '記憶體'], ['zh-TW', '記憶體']]) {
    setLanguage(language);
    assert.equal(t('label.approxRam'), expected, language);
  }
});

test('Traditional Chinese keeps its own wording and patterns', () => {
  setLanguage('zh-Hant');
  assert.equal(t('label.promptCache'), '快取');
  assert.equal(t('label.hooks'), 'Hook');
  assert.equal(t('status.limitReached'), '已達上限');
  assert.equal(t('format.untilTime'), '至 {time}');
  assert.equal(t('format.relativeTime'), '{value} 前');
});

test('isCjkLanguage is true for every Chinese variant', () => {
  assert.equal(isCjkLanguage(), false);
  for (const language of ['zh', 'zh-Hans', 'zh-Hant', 'zh-TW']) {
    setLanguage(language);
    assert.equal(isCjkLanguage(), true, language);
  }
});
