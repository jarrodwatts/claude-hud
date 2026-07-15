import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitize, parseExtraCmdArg, runExtraCmd, isExtraCmdAllowed } from '../dist/extra-cmd.js';

// ============================================================================
// sanitize() tests
// ============================================================================

test('sanitize strips ANSI CSI sequences', () => {
  const input = '\x1B[31mRed\x1B[0m Text';
  assert.equal(sanitize(input), 'Red Text');
});

test('sanitize strips OSC sequences', () => {
  const input = '\x1B]0;Window Title\x07Normal Text';
  assert.equal(sanitize(input), 'Normal Text');
});

test('sanitize strips C0 control characters', () => {
  const input = 'Hello\x00World\x1FTest';
  assert.equal(sanitize(input), 'HelloWorldTest');
});

test('sanitize strips C1 control characters', () => {
  const input = 'Hello\x80World\x9FTest';
  assert.equal(sanitize(input), 'HelloWorldTest');
});

test('sanitize strips bidi control characters', () => {
  const input = 'Hello\u200EWorld\u202ATest\u2069End';
  assert.equal(sanitize(input), 'HelloWorldTestEnd');
});

test('sanitize preserves normal text', () => {
  const input = 'Just normal text 123!';
  assert.equal(sanitize(input), 'Just normal text 123!');
});

test('sanitize handles empty string', () => {
  assert.equal(sanitize(''), '');
});

test('sanitize handles complex mixed escape sequences', () => {
  const input = '\x1B[1;32mBold Green\x1B[0m \x1B]0;Title\x07 \x00Hidden\x1F';
  assert.equal(sanitize(input), 'Bold Green  Hidden');
});

// ============================================================================
// parseExtraCmdArg() tests
// ============================================================================

test('parseExtraCmdArg returns null when no --extra-cmd present', () => {
  const argv = ['node', 'index.js', '--other', 'arg'];
  assert.equal(parseExtraCmdArg(argv), null);
});

test('isExtraCmdAllowed requires explicit opt-in', () => {
  assert.equal(isExtraCmdAllowed({}), false);
  assert.equal(isExtraCmdAllowed({ CLAUDE_HUD_ALLOW_EXTRA_CMD: '0' }), false);
  assert.equal(isExtraCmdAllowed({ CLAUDE_HUD_ALLOW_EXTRA_CMD: '1' }), true);
  assert.equal(isExtraCmdAllowed({ CLAUDE_HUD_ALLOW_EXTRA_CMD: 'true' }), true);
  assert.equal(isExtraCmdAllowed({ CLAUDE_HUD_ALLOW_EXTRA_CMD: ' TRUE ' }), true);
  assert.equal(isExtraCmdAllowed({ CLAUDE_HUD_ALLOW_EXTRA_CMD: 'yes' }), true);
  assert.equal(isExtraCmdAllowed({ CLAUDE_HUD_ALLOW_EXTRA_CMD: 'on' }), true);
});

test('parseExtraCmdArg ignores --extra-cmd unless explicitly enabled', () => {
  const argv = ['node', 'index.js', '--extra-cmd', 'echo hello'];
  assert.equal(parseExtraCmdArg(argv, {}), null);
});

test('parseExtraCmdArg ignores --extra-cmd=value unless explicitly enabled', () => {
  const argv = ['node', 'index.js', '--extra-cmd=echo hello'];
  assert.equal(parseExtraCmdArg(argv, {}), null);
});

test('parseExtraCmdArg parses --extra-cmd value syntax', () => {
  const argv = ['node', 'index.js', '--extra-cmd', 'echo hello'];
  assert.equal(parseExtraCmdArg(argv, { CLAUDE_HUD_ALLOW_EXTRA_CMD: '1' }), 'echo hello');
});

test('parseExtraCmdArg parses --extra-cmd=value syntax', () => {
  const argv = ['node', 'index.js', '--extra-cmd=echo hello'];
  assert.equal(parseExtraCmdArg(argv, { CLAUDE_HUD_ALLOW_EXTRA_CMD: '1' }), 'echo hello');
});

test('parseExtraCmdArg returns null when --extra-cmd is last arg with space syntax', () => {
  const argv = ['node', 'index.js', '--extra-cmd'];
  assert.equal(parseExtraCmdArg(argv, { CLAUDE_HUD_ALLOW_EXTRA_CMD: '1' }), null);
});

test('parseExtraCmdArg returns null for empty value with equals syntax', () => {
  const argv = ['node', 'index.js', '--extra-cmd='];
  assert.equal(parseExtraCmdArg(argv, { CLAUDE_HUD_ALLOW_EXTRA_CMD: '1' }), null);
});

test('parseExtraCmdArg returns null for empty value with space syntax', () => {
  const argv = ['node', 'index.js', '--extra-cmd', ''];
  assert.equal(parseExtraCmdArg(argv, { CLAUDE_HUD_ALLOW_EXTRA_CMD: '1' }), null);
});

test('parseExtraCmdArg handles command with equals sign in value', () => {
  const argv = ['node', 'index.js', '--extra-cmd=echo "key=value"'];
  assert.equal(parseExtraCmdArg(argv, { CLAUDE_HUD_ALLOW_EXTRA_CMD: '1' }), 'echo "key=value"');
});

test('parseExtraCmdArg takes first occurrence when multiple present', () => {
  const argv = ['node', 'index.js', '--extra-cmd', 'first', '--extra-cmd', 'second'];
  assert.equal(parseExtraCmdArg(argv, { CLAUDE_HUD_ALLOW_EXTRA_CMD: '1' }), 'first');
});

test('parseExtraCmdArg handles command with spaces and quotes', () => {
  const argv = ['node', 'index.js', '--extra-cmd', 'echo "hello world"'];
  assert.equal(parseExtraCmdArg(argv, { CLAUDE_HUD_ALLOW_EXTRA_CMD: '1' }), 'echo "hello world"');
});

// ============================================================================
// runExtraCmd() tests
// ============================================================================

test('runExtraCmd returns label from valid JSON output', async () => {
  const result = await runExtraCmd('echo \'{"label": "test"}\'');
  assert.equal(result, 'test');
});

test('runExtraCmd returns the last non-empty line from plain output', async () => {
  const result = await runExtraCmd('printf "setup\\nnot json\\n"');
  assert.equal(result, 'not json');
});

test('runExtraCmd sanitizes terminal escapes from plain output', async () => {
  const result = await runExtraCmd('printf "plain\\033[31mred\\033[0m\\n"');
  assert.equal(result, 'plainred');
});

test('runExtraCmd returns null for JSON without label field', async () => {
  const result = await runExtraCmd('echo \'{"other": "field"}\'');
  assert.equal(result, null);
});

test('runExtraCmd returns null for JSON with non-string label', async () => {
  const result = await runExtraCmd('echo \'{"label": 123}\'');
  assert.equal(result, null);
});

test('runExtraCmd truncates long labels with ellipsis', async () => {
  const longLabel = 'a'.repeat(60);
  const result = await runExtraCmd(`echo '{"label": "${longLabel}"}'`);
  assert.equal(result?.length, 50);
  assert.ok(result?.endsWith('…'));
});

test('runExtraCmd sanitizes output containing escape sequences', async () => {
  const result = await runExtraCmd('echo \'{"label": "\\u001b[31mRed\\u001b[0m"}\'');
  assert.equal(result, 'Red');
});

test('runExtraCmd returns null when command fails', async () => {
  const result = await runExtraCmd('exit 1');
  assert.equal(result, null);
});

test('runExtraCmd returns null when command does not exist', async () => {
  const result = await runExtraCmd('nonexistent-command-xyz123');
  assert.equal(result, null);
});

test('runExtraCmd handles timeout', async () => {
  const start = Date.now();
  const result = await runExtraCmd('sleep 10', 100);
  const elapsed = Date.now() - start;
  assert.equal(result, null);
  assert.ok(elapsed < 1000, `Expected timeout around 100ms, but took ${elapsed}ms`);
});

test('runExtraCmd handles empty stdout', async () => {
  const result = await runExtraCmd('echo ""');
  assert.equal(result, null);
});

test('runExtraCmd handles JSON array instead of object', async () => {
  const result = await runExtraCmd('echo \'[1,2,3]\'');
  assert.equal(result, null);
});

test('runExtraCmd handles null JSON', async () => {
  const result = await runExtraCmd('echo "null"');
  assert.equal(result, null);
});

test('runExtraCmd handles valid JSON with extra whitespace', async () => {
  const result = await runExtraCmd('echo \'  { "label": "trimmed" }  \'');
  assert.equal(result, 'trimmed');
});
