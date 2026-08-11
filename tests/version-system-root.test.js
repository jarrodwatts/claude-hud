import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  _getClaudeVersionInvocation,
  _setVersionInvocationEnvForTests,
} from '../dist/version.js';

const originalSystemRoot = process.env.SystemRoot;
const originalSystemRootUpper = process.env.SYSTEMROOT;

function restoreEnvVar(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

afterEach(() => {
  restoreEnvVar('SystemRoot', originalSystemRoot);
  restoreEnvVar('SYSTEMROOT', originalSystemRootUpper);
  _setVersionInvocationEnvForTests(null, null);
});

test('_getClaudeVersionInvocation resolves cmd.exe from SystemRoot', () => {
  process.env.SystemRoot = 'D:\\Windows';
  delete process.env.SYSTEMROOT;
  _setVersionInvocationEnvForTests(null, null);

  const invocation = _getClaudeVersionInvocation(
    'C:\\Program Files\\Claude\\claude.cmd',
    'win32',
  );

  assert.equal(invocation.file, 'D:\\Windows\\System32\\cmd.exe');
});

test('_getClaudeVersionInvocation rejects non-absolute SystemRoot values', () => {
  process.env.SystemRoot = 'relative\\Windows';
  delete process.env.SYSTEMROOT;
  _setVersionInvocationEnvForTests(null, null);

  const invocation = _getClaudeVersionInvocation(
    'C:\\Program Files\\Claude\\claude.cmd',
    'win32',
  );

  assert.equal(invocation.file, 'C:\\Windows\\System32\\cmd.exe');
});
