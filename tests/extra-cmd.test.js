import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseExtraCmdArg, runExtraCmd, isExtraCmdAllowed } from '../dist/extra-cmd.js';

const ALLOWED = { CLAUDE_HUD_ALLOW_EXTRA_CMD: '1' };
const argv = (...args) => ['node', 'index.js', ...args];

test('--extra-cmd needs an explicit opt-in', () => {
  for (const value of ['1', 'true', 'YES', ' on ']) {
    assert.equal(isExtraCmdAllowed({ CLAUDE_HUD_ALLOW_EXTRA_CMD: value }), true, value);
  }
  for (const value of [undefined, '', '0', 'false', 'enabled']) {
    assert.equal(isExtraCmdAllowed({ CLAUDE_HUD_ALLOW_EXTRA_CMD: value }), false, String(value));
  }
  assert.equal(parseExtraCmdArg(argv('--extra-cmd', 'echo hi'), {}), null);
  assert.equal(parseExtraCmdArg(argv('--extra-cmd=echo hi'), {}), null);
});

test('parseExtraCmdArg reads both argument forms', () => {
  assert.equal(parseExtraCmdArg(argv(), ALLOWED), null);
  assert.equal(parseExtraCmdArg(argv('--extra-cmd', 'echo "hello world"'), ALLOWED), 'echo "hello world"');
  assert.equal(parseExtraCmdArg(argv('--extra-cmd=echo a=b'), ALLOWED), 'echo a=b');
  assert.equal(parseExtraCmdArg(argv('--extra-cmd=first', '--extra-cmd', 'second'), ALLOWED), 'first');
  assert.equal(parseExtraCmdArg(argv('--extra-cmd'), ALLOWED), null);
  assert.equal(parseExtraCmdArg(argv('--extra-cmd', ''), ALLOWED), null);
  assert.equal(parseExtraCmdArg(argv('--extra-cmd='), ALLOWED), null);
});

test('runExtraCmd takes a JSON label or the last line of plain output', async () => {
  assert.equal(await runExtraCmd('echo \'  { "label": "test" }  \''), 'test');
  assert.equal(await runExtraCmd('printf "setup\\nnot json\\n"'), 'not json');
  for (const output of ['{"other": "field"}', '{"label": 123}', '[1,2,3]', 'null', '']) {
    assert.equal(await runExtraCmd(`echo '${output}'`), null, output);
  }
});

test('runExtraCmd sanitizes and truncates the label', async () => {
  assert.equal(await runExtraCmd('printf "plain\\033[31mred\\033[0m\\n"'), 'plainred');
  assert.equal(await runExtraCmd('echo \'{"label": "\\u001b]8;;https://x\\u0007Red\\u001b]8;;\\u0007"}\''), 'Red');
  const long = await runExtraCmd(`echo '{"label": "${'a'.repeat(60)}"}'`);
  assert.equal(long?.length, 50);
  assert.ok(long?.endsWith('…'));
});

test('runExtraCmd returns null on failure or timeout', async () => {
  assert.equal(await runExtraCmd('exit 1'), null);
  assert.equal(await runExtraCmd('nonexistent-command-xyz123'), null);
  const start = Date.now();
  assert.equal(await runExtraCmd('sleep 10', 100), null);
  assert.ok(Date.now() - start < 1000, 'gave up at the timeout');
});
