// Copies non-TypeScript runtime assets into dist/ after `tsc`.
// tsc only emits compiled .js/.d.ts and never copies data files, so any
// JSON the runtime reads relative to its compiled module must be copied here.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const assets = [
  ['src/pricing.json', 'dist/pricing.json'],
];

for (const [from, to] of assets) {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}
