// P5: ARCHITECTURE.md's diagram is a test. It fails when a src file is in no box or in two, when a
// runtime import crosses boxes with no arrow, and when an arrow is drawn that no import uses.
// Rounded nodes are Node builtins, so an arrow into one is permission to touch the world that way.
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = path.join(root, 'src');
const mermaid = fs.readFileSync(path.join(root, 'ARCHITECTURE.md'), 'utf8').match(/```mermaid\n([\s\S]*?)```/)?.[1] ?? '';
const boxes = {}; // id -> globs
const builtins = {}; // id -> module names
const arrows = new Set();
for (const m of mermaid.matchAll(/^\s*(\w+)\["[^":]+: ([^"]+)"\]/gm)) boxes[m[1]] = m[2].trim().split(/\s+/);
for (const m of mermaid.matchAll(/^\s*(\w+)\(\["([^"]+)"\]\)/gm)) builtins[m[1]] = m[2].trim().split(/\s+/);
for (const line of mermaid.split('\n').filter((l) => l.includes('-->'))) {
  const sides = line.split('-->').map((side) => side.split('&').map((id) => id.trim()));
  for (let i = 1; i < sides.length; i++) for (const a of sides[i - 1]) for (const b of sides[i]) arrows.add(`${a} --> ${b}`);
}

const toRegex = (glob) => new RegExp(`^${glob.replace(/[.]/g, '\\.').replace(/\*\*/g, '\0').replace(/\*/g, '[^/]*').replace(/\0/g, '.*')}$`);
const files = fs.readdirSync(src, { recursive: true }).map((f) => f.split(path.sep).join('/')).filter((f) => f.endsWith('.ts'));
const errors = [];
const boxOf = Object.fromEntries(files.map((file) => {
  const hits = Object.keys(boxes).filter((id) => boxes[id].some((g) => toRegex(g).test(file)));
  if (hits.length !== 1) errors.push(`${file} is in ${hits.length ? `${hits.length} boxes (${hits.join(', ')})` : 'no box'}`);
  return [file, hits[0]];
}));

// Runtime imports only: type-only imports vanish when Node strips the types.
const used = new Set();
const need = (file, what, from, to) => {
  if (!from || !to || from === to) return;
  if (arrows.has(`${from} --> ${to}`)) used.add(`${from} --> ${to}`);
  else errors.push(`${file} ${what}, but no arrow ${from} --> ${to}`);
};
for (const file of files) {
  const code = stripTypeScriptTypes(fs.readFileSync(path.join(src, file), 'utf8'));
  const specs = code.matchAll(/(?:^|[\s;])(?:import|export)\s[^'"]*?\sfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm);
  for (const m of specs) {
    const spec = m[1] ?? m[2] ?? m[3];
    if (spec.startsWith('.')) {
      const dep = path.posix.join(path.posix.dirname(file), spec).replace(/\.js$/, '.ts');
      if (dep in boxOf) need(file, `imports ${dep}`, boxOf[file], boxOf[dep]);
      else errors.push(`${file} imports ${dep}, which is not in src`);
    } else {
      const name = spec.replace(/^node:/, '');
      const node = Object.keys(builtins).find((id) => builtins[id].includes(name));
      if (!node) errors.push(`${file} uses ${spec}, which is on no rounded node`);
      need(file, `uses ${spec}`, boxOf[file], node);
    }
  }
}
for (const a of arrows) if (!used.has(a)) errors.push(`arrow ${a} is drawn but no import uses it`);
if (!Object.keys(boxes).length) errors.push('ARCHITECTURE.md has no ```mermaid block with boxes');
console.log(errors.length ? errors.map((e) => `FAIL ${e}`).join('\n') : `ok: ${files.length} files in ${Object.keys(boxes).length} boxes, ${arrows.size} arrows, all used`);
process.exitCode = errors.length ? 1 : 0;
