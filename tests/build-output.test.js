import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = join(repositoryRoot, 'src');
const outputRoot = join(repositoryRoot, 'dist');

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

test('every compiled artifact has a current TypeScript source file', () => {
  for (const outputPath of listFiles(outputRoot)) {
    const relativeOutput = relative(outputRoot, outputPath);
    const relativeSource = relativeOutput.replace(
      /(?:\.d\.ts\.map|\.js\.map|\.d\.ts|\.js)$/,
      '.ts',
    );

    assert.ok(
      existsSync(join(sourceRoot, relativeSource)),
      `orphaned compiled artifact: dist/${relativeOutput}`,
    );
  }
});
