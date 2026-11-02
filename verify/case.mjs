// The corpus contract, shared by the corpus runner, the e2e check and the maintainer's intake.
// FIELDS is the fixture schema. EXPECT is the closed vocabulary: a fixture may only use these
// words, so its properties outlive any redesign and nobody ever needs to edit an old fixture.
import { terminalFilter } from '../hud.mjs';

export const FIELDS = {
  note: 'string', // what broke, with the issue or CHANGELOG link (required)
  columns: 'number', // the COLUMNS the HUD gets (required)
  stdin: 'object|string', // Claude Code's payload; a string is sent as raw bytes (required)
  expect: 'array', // words from EXPECT (required)
  config: 'object', // non-default config.json keys
  versions: 'object', // { claudeCode, node, hud } from the report
  platform: 'string', // process.platform; the case runs only there
  tz: 'string', // TZ, default UTC
  now: 'string', // ISO time of the render's clock
  facts: 'object', // the probes' answers by probe name (createProbes in collector.mjs), replayed instead of run
  stdinOpen: 'boolean', // leave the pipe open after writing stdin
};
const REQUIRED = ['note', 'columns', 'stdin', 'expect'];

// Text a terminal shows, and what a terminal does with the rest.
const SGR = /\x1b\[[0-9;:]*m/g;
const OSC8 = /\x1b\]8;[^;\x07\x1b]*;([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
export const visible = (s) => s.replace(SGR, '').replace(OSC8, '');
const wide = /[ᄀ-ᅟ⺀-〾ぁ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|[\u{1f300}-\u{1faff}\u{20000}-\u{3fffd}]/u;
const zero = /[\p{M}​-‍︀-️]/u;
export const cells = (s) => [...visible(s)].reduce((n, ch) => n + (zero.test(ch) ? 0 : wide.test(ch) ? 2 : 1), 0);

// Safe means hud.mjs's own terminal filter keeps every byte: one allow list for the filter and the checks.
export function unsafeEscape(text, stdin = null) {
  const filter = terminalFilter(stdin !== null && typeof stdin === 'object' ? stdin : null);
  for (const line of text.split('\n')) {
    const kept = filter(line);
    if (kept === line) continue;
    let at = 0;
    while (line[at] === kept[at]) at++;
    return `escape ${JSON.stringify(line.slice(at, at + 24))}`;
  }
  return null;
}
// A line leaves a link open when its last OSC 8 sequence opens one.
const openLink = (line) => Boolean([...line.matchAll(OSC8)].at(-1)?.[1]);

// Each word: pattern -> (result {code, out, raw?, err, ms}, case, ...captures) -> true or the reason it failed.
// `out` is what reaches the terminal; `raw` is logic's own lines, before hud.mjs's filter.
const lines = (r) => r.out.replace(/\n$/, '').split('\n');
export const EXPECT = [
  [/^exit 0$/, (r) => r.code === 0 || `exit ${r.code}: ${r.err.slice(0, 200)}`],
  [/^finishes within (\d+)ms$/, (r, c, ms) => r.ms <= Number(ms) || `took ${r.ms}ms`],
  [/^at most (\d+) lines$/, (r, c, n) => lines(r).length <= Number(n) || `${lines(r).length} lines`],
  [/^no line wider than columns$/, (r, c) => lines(r).every((l) => cells(l) <= c.columns) || `a line is ${Math.max(...lines(r).map(cells))} cells`],
  [/^every line closes its OSC 8 link$/, (r) => !lines(r).some(openLink) || 'a line leaves a link open'],
  // Judged on logic's own lines, so the filter stays a second wall rather than the only one.
  [/^only safe escapes$/, (r, c) => !unsafeEscape(r.raw ?? r.out, c.stdin) || `unsafe ${unsafeEscape(r.raw ?? r.out, c.stdin)}`],
  [/^no lone surrogate$/, (r) => !/[�\p{Cs}]/u.test(r.out) || 'a character was cut in half'],
  [/^contains (.+)$/s, (r, c, text) => visible(r.out).includes(text) || `no ${JSON.stringify(text)}`],
  [/^lacks (.+)$/s, (r, c, text) => !visible(r.out).includes(text) || `has ${JSON.stringify(text)}`],
];

export function checkExpect(word, result, c) {
  for (const [pattern, check] of EXPECT) {
    const m = pattern.exec(word);
    if (m) return check(result, c, ...m.slice(1));
  }
  return `unknown expectation ${JSON.stringify(word)}`;
}

// Returns a list of problems; empty means the case is valid.
export function validateCase(c) {
  if (c === null || typeof c !== 'object' || Array.isArray(c)) return ['a case is a JSON object'];
  const errors = REQUIRED.filter((k) => !(k in c)).map((k) => `missing ${k}`);
  for (const [k, v] of Object.entries(c)) {
    const type = Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v;
    if (!FIELDS[k]) errors.push(`unknown field ${k}`);
    else if (!FIELDS[k].split('|').includes(type)) errors.push(`${k} must be ${FIELDS[k]}`);
  }
  if (Array.isArray(c.expect)) {
    if (!c.expect.length) errors.push('expect is empty');
    for (const w of c.expect) if (typeof w !== 'string' || !EXPECT.some(([p]) => p.test(w))) errors.push(`unknown expectation ${JSON.stringify(w)}`);
  }
  if (typeof c.columns === 'number' && !(c.columns > 0 && c.columns <= 1000)) errors.push('columns must be 1-1000');
  return errors;
}
