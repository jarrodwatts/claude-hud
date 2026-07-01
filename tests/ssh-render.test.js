import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSshLine } from '../dist/render/ssh-line.js';
import { mergeConfig } from '../dist/config.js';

function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function ctxWith(showSsh, sshTargets) {
  return {
    config: mergeConfig({ display: { showSsh } }),
    transcript: { sshTargets },
  };
}

test('renderSshLine returns null when showSsh is disabled', () => {
  const ctx = ctxWith(false, [{ host: '10.0.0.1', port: 22, source: 'main', lastSeen: 1 }]);
  assert.equal(renderSshLine(ctx), null);
});

test('renderSshLine returns null when there are no targets', () => {
  assert.equal(renderSshLine(ctxWith(true, [])), null);
  assert.equal(renderSshLine(ctxWith(true, undefined)), null);
});

test('renderSshLine renders the main target with a ⚡ marker', () => {
  const ctx = ctxWith(true, [{ host: '44.245.72.210', port: 22, source: 'main', lastSeen: 1 }]);
  const line = stripAnsi(renderSshLine(ctx));
  assert.ok(line.includes('⚡'), 'has lightning marker');
  assert.ok(line.includes('SSH'), 'has SSH label');
  assert.ok(line.includes('main 44.245.72.210:22'), `main target formatted: ${line}`);
});

test('renderSshLine labels subagents with a short id and joins with ·', () => {
  const ctx = ctxWith(true, [
    { host: '44.245.72.210', port: 22, source: 'main', lastSeen: 3 },
    { host: '10.0.0.5', port: 2222, source: 'subagent', agentId: 'a4ad710ecd0c0c2ad', lastSeen: 2 },
  ]);
  const line = stripAnsi(renderSshLine(ctx));
  assert.ok(line.includes('main 44.245.72.210:22'), `main: ${line}`);
  assert.ok(line.includes('sub#a4ad71 10.0.0.5:2222'), `subagent short id + host:port: ${line}`);
  assert.ok(line.includes(' · '), `middle-dot separator: ${line}`);
});
