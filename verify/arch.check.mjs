// P5: ARCHITECTURE.md's diagram is a test. It fails when a src file is in no box or in two, when a
// runtime import crosses boxes with no arrow, when an arrow is drawn that no import uses, and when
// the builtins drawn are not exactly the ones fence.mjs lets logic load.
//   box["name: globs"]          files in src/ (globs relative to src/)
//   node(["node:a node:b"])     Node builtins: an arrow into one is permission to use them
//   file[["hud.mjs"]]           owner code outside src/ (only the launcher stubs may import it)
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = path.join(root, 'src');
const mermaid = fs.readFileSync(path.join(root, 'ARCHITECTURE.md'), 'utf8').match(/```mermaid\n([\s\S]*?)```/)?.[1] ?? '';
const boxes = {}; // id -> globs
const builtins = {}; // id -> module names
const owned = {}; // id -> file under the plugin root
const arrows = new Set();
for (const m of mermaid.matchAll(/^\s*(\w+)\["[^":]+: ([^"]+)"\]/gm)) boxes[m[1]] = m[2].trim().split(/\s+/);
for (const m of mermaid.matchAll(/^\s*(\w+)\(\["([^"]+)"\]\)/gm)) builtins[m[1]] = m[2].trim().split(/\s+/).map((n) => n.replace(/^node:/, ''));
for (const m of mermaid.matchAll(/^\s*(\w+)\[\["([^"]+)"\]\]/gm)) owned[m[1]] = m[2].trim();
for (const line of mermaid.split('\n').filter((l) => l.includes('-->'))) {
  const sides = line.split('-->').map((side) => side.split('&').map((id) => id.trim()));
  for (let i = 1; i < sides.length; i++) for (const a of sides[i - 1]) for (const b of sides[i]) arrows.add(`${a} --> ${b}`);
}

const errors = [];
// The builtins drawn must be fence.mjs's load allow list, no more and no less.
const fence = fs.readFileSync(path.join(root, 'fence.mjs'), 'utf8').match(/const ALLOWED = table\(\{([^}]*)\}\)/)?.[1] ?? '';
const allowed = [...fence.matchAll(/'node:([^']+)'/g)].map((m) => m[1]).sort();
const drawn = Object.values(builtins).flat().sort();
if (!allowed.length) errors.push('no ALLOWED table found in fence.mjs');
if (allowed.join(' ') !== drawn.join(' ')) errors.push(`the builtins drawn (${drawn.join(' ')}) are not fence.mjs's allow list (${allowed.join(' ')})`);

const toRegex = (glob) => new RegExp(`^${glob.replace(/[.]/g, '\\.').replace(/\*\*/g, '\0').replace(/\*/g, '[^/]*').replace(/\0/g, '.*')}$`);
const files = fs.readdirSync(src, { recursive: true }).map((f) => f.split(path.sep).join('/')).filter((f) => f.endsWith('.ts'));
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
      const dep = path.posix.join(path.posix.dirname(file), spec);
      const outside = Object.keys(owned).find((id) => path.posix.join('src', dep) === path.posix.normalize(owned[id]));
      if (dep in boxOf) need(file, `imports ${dep}`, boxOf[file], boxOf[dep]);
      else if (outside) need(file, `imports ${owned[outside]}`, boxOf[file], outside);
      else errors.push(`${file} imports ${dep}, which is not in src or drawn`);
    } else {
      const name = spec.replace(/^node:/, '');
      const node = Object.keys(builtins).find((id) => builtins[id].includes(name));
      if (!node) errors.push(`${file} uses ${spec}, which fence.mjs refuses and the diagram does not draw`);
      need(file, `uses ${spec}`, boxOf[file], node);
    }
  }
}
for (const a of arrows) if (!used.has(a)) errors.push(`arrow ${a} is drawn but no import uses it`);
if (!Object.keys(boxes).length) errors.push('ARCHITECTURE.md has no ```mermaid block with boxes');
console.log(errors.length ? errors.map((e) => `FAIL ${e}`).join('\n')
  : `ok: ${files.length} files in ${Object.keys(boxes).length} boxes, ${arrows.size} arrows, all used; builtins = fence.mjs's ${allowed.length}`);
process.exitCode = errors.length ? 1 : 0;
