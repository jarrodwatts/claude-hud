// The owner's own safety code, judged by fixed data. The agent may edit tests/ but not this file, so
// a later change to hud.mjs or collector.mjs can't loosen one of these walls and its test together.
//   - the terminal filter keeps exactly these bytes (verify/case.mjs judges output with it, so this pins the judge too)
//   - logic's environment and Node flags hold no secret and no capability
//   - on Windows, git, jj and taskkill never run from the repo's folder
//   - a repo's own git config never runs a command, through status, line diffs or a submodule
//   - `hud set` can't change which files the collector reads or writes
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cageArgs, cageEnv, terminalFilter } from '../hud.mjs';
import { claudePaths, createProbes, resolveTaskkillPath, resolveWindowsExecutable, writeConfig } from '../collector.mjs';

const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(true);
    console.log(`  ok ${name}`);
  } catch (error) {
    results.push(false);
    console.log(`FAIL ${name}\n${String(error.message).slice(0, 2000)}`);
  }
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-owner-'));

try {
  await check('the terminal filter keeps colour, file: links and links into the session\'s repo, byte for byte', () => {
    const filter = terminalFilter({ workspace: { repo: { host: 'github.com', owner: 'o', name: 'r' } } });
    const link = (url, text) => `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;
    for (const kept of ['\x1b[0m\x1b[36m[Opus]\x1b[0m', '\x1b[38;2;0;255;0mx\x1b[38;5;208my', link('file:///home/u/my%20project', 'p'),
      link('https://github.com/o/r/tree/main', 'main'), link('https://github.com/o/r/commit/abc1234', 'c'), link('file://C:/Users/ü/項目', 'p'), 'a\u00a0b 全']) {
      assert.equal(filter(kept), kept);
    }
  });

  await check('the terminal filter drops every other escape whole, and every control and bidi character', () => {
    const filter = terminalFilter({ workspace: { repo: { host: 'github.com', owner: 'o', name: 'r' } } });
    const link = (url, text) => `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;
    for (const url of ['https://evil.example/', 'https://github.com/evil/r/tree/main', 'https://github.com/o/r/../../evil/x', 'https://github.com/o/rx/',
      'http://github.com/o/r/', 'javascript:alert(1)']) {
      assert.equal(filter(link(url, 'x')), 'x\x1b]8;;\x1b\\', url);
    }
    assert.equal(terminalFilter(null)(link('https://github.com/o/r/tree/main', 'x')), 'x\x1b]8;;\x1b\\', 'no repo reported, no web links');
    const dropped = {
      'a\x1b]52;c;ZXZpbA==\x07b': 'ab', // OSC 52 writes the clipboard
      'a\x1b]52;c;ZXZpbA==\x1b\\b': 'ab',
      'a\x1b]0;title\x07b': 'ab',
      'a\x1b[2Jb\x1b[1;1Hc': 'abc',
      'a\x1b[?1049hb': 'ab',
      'a\rb\tc\x9bd\x00e\x7f': 'abcde',
      'a\u202eb\u2066c\u200fd': 'abcd',
      'a\x1b]8;;https://evil.example/': 'a', // an unterminated sequence goes to the end of the line
    };
    for (const [input, output] of Object.entries(dropped)) assert.equal(filter(input), output, JSON.stringify(input));
  });

  await check('logic gets no PATH and no secrets', () => {
    assert.deepEqual(cageEnv({
      PATH: '/usr/bin', HOME: '/home/u', TZ: 'UTC', CLAUDE_CONFIG_DIR: '/c', ANTHROPIC_API_KEY: 'sk-ant-fake',
      CLAUDE_CODE_OAUTH_TOKEN: 'fake', GITHUB_TOKEN: 'fake', AWS_SECRET_ACCESS_KEY: 'fake', NODE_OPTIONS: '--require /x.js',
      ANTHROPIC_BASE_URL: 'https://user:pass@api.minimax.io/anthropic?key=fake',
    }), { PATH: '', HOME: '/home/u', TZ: 'UTC', CLAUDE_CONFIG_DIR: '/c', ANTHROPIC_API_KEY: 'set', ANTHROPIC_BASE_URL: 'https://api.minimax.io/anthropic' });
  });

  await check('the cage grants reads and one write folder, and never child processes, workers, addons, WASI or the network', () => {
    const args = cageArgs({ grants: ['/a', '/b'], dataDir: '/d' });
    assert.deepEqual(args.filter((a) => a.startsWith('--allow-')), ['--allow-fs-read=/a', '--allow-fs-read=/b', '--allow-fs-write=/d']);
    assert.equal(args[0], '--permission');
    assert.match(args.at(-2), /^--import=file:.*\/fence\.mjs$/);
    assert.ok(!cageArgs({ grants: [], dataDir: null }).some((a) => a.startsWith('--allow-fs-write')));
  });

  await check('on Windows, git and jj come from absolute PATH entries only, and taskkill from SystemRoot', () => {
    for (const name of ['git', 'jj']) {
      const tried = [];
      const found = resolveWindowsExecutable(name, { Path: `.;.\\repo-bin;;C:\\Program Files\\${name};D:\\fallback` }, (candidate) => {
        tried.push(candidate);
        return candidate.startsWith('C:\\') ? candidate : null;
      });
      assert.deepEqual(tried, [`C:\\Program Files\\${name}\\${name}.exe`], name);
      assert.equal(found, `C:\\Program Files\\${name}\\${name}.exe`);
      assert.equal(resolveWindowsExecutable(name, { Path: '.;repo' }, (c) => c), null, `${name}: nothing absolute on PATH, nothing runs`);
    }
    assert.equal(resolveTaskkillPath({ SystemRoot: 'C:\\Windows' }), 'C:\\Windows\\System32\\taskkill.exe');
    for (const SystemRoot of ['relative\\Windows', '\\\\server\\share', 'C:\\Windows\0elsewhere', undefined]) assert.equal(resolveTaskkillPath({ SystemRoot }), null);
  });

  // A repo whose own config names commands: core.fsmonitor runs on every status (GHSA-fq7j-8hxj-jfqh), and a
  // filter driver whenever git hashes a changed file, from .git/config, a file it includes, or a submodule's config.
  await check('a repo\'s own git config never runs a command, through status, line diffs or a submodule', async () => {
    process.env.GIT_CONFIG_GLOBAL = path.join(tmp, 'empty-gitconfig');
    process.env.GIT_CONFIG_NOSYSTEM = '1';
    fs.writeFileSync(process.env.GIT_CONFIG_GLOBAL, '');
    const ran = (what) => path.join(tmp, `ran-${what}`);
    const repo = (name) => {
      const dir = path.join(tmp, name);
      fs.mkdirSync(dir);
      const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'protocol.file.allow=always', ...args],
        { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      git('init', '-q', '-b', 'main');
      fs.writeFileSync(path.join(dir, '.gitattributes'), '*.txt filter=evil\n*.md filter=in.cluded\n');
      for (const file of ['a.txt', 'b.md']) fs.writeFileSync(path.join(dir, file), `${file}\n`);
      git('add', '.');
      git('commit', '-qm', 'files');
      return { dir, git };
    };
    const config = (file, entries) => {
      for (const [key, value] of Object.entries(entries)) execFileSync('git', ['config', '--file', file, key, value]);
    };
    const sub = repo('sub');
    const main = repo('main');
    main.git('submodule', '-q', 'add', sub.dir, 'sm');
    main.git('commit', '-qm', 'submodule');
    config(path.join(main.dir, '.git', 'config'), {
      'core.fsmonitor': `touch '${ran('fsmonitor')}'`,
      'filter.evil.clean': `sh -c 'touch "${ran('filter')}"; cat'`,
      'include.path': 'included',
    });
    config(path.join(main.dir, '.git', 'included'), { 'filter.in.cluded.clean': `sh -c 'touch "${ran('included')}"; cat'` });
    config(path.join(main.dir, '.git', 'modules', 'sm', 'config'), { 'filter.evil.clean': `sh -c 'touch "${ran('submodule')}"; cat'` });
    // Stale stat data makes git hash every file again, through its filter.
    const old = new Date('2020-01-01T00:00:00Z');
    for (const file of ['a.txt', 'b.md', 'sm/a.txt', 'sm/b.md']) fs.utimesSync(path.join(main.dir, file), old, old);
    fs.appendFileSync(path.join(main.dir, 'a.txt'), 'more\n');

    const answers = await createProbes({ cwd: main.dir, argv: [] })(['git.status', 'git.numstat', 'git.branch']);
    assert.match(answers['git.status']?.stdout ?? '', /branch\.head main/, JSON.stringify(answers));
    assert.match(answers['git.numstat']?.stdout ?? '', /^1\t0\ta\.txt/, 'still reports the change');
    for (const what of ['fsmonitor', 'filter', 'included', 'submodule']) assert.ok(!fs.existsSync(ran(what)), `${what} ran`);

    // The control: the same repo's filter does run when git is run plainly, so the check above can fail.
    main.git('add', 'a.txt');
    assert.ok(fs.existsSync(ran('filter')), 'the planted filter never runs at all, so this check proves nothing');
  });

  await check('`hud set` keeps the keys that name files from disk, whatever logic hands back', () => {
    const paths = claudePaths({}, tmp);
    fs.mkdirSync(paths.hudDir, { recursive: true });
    fs.writeFileSync(paths.configPath, JSON.stringify({ display: { externalUsagePath: '/mine.json' } }));
    writeConfig(paths, { display: { showTools: true, externalUsagePath: '/evil.json', externalUsageWritePath: '/home/u/.bashrc.json' } });
    assert.deepEqual(JSON.parse(fs.readFileSync(paths.configPath, 'utf8')), { display: { showTools: true, externalUsagePath: '/mine.json' } });
  });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
const held = results.filter(Boolean).length;
console.log(`${held === results.length ? '' : 'FAIL '}${held}/${results.length} owner checks hold`);
process.exitCode = held === results.length ? 0 : 1;
