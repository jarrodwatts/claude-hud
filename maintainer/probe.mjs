// The reach probe (owner-owned). The harness runs it as the jailed `agent` user before Claude starts.
// Each check tries one way out of the jail; "reachable" means the attempt worked. Any reachable check aborts the run.
//   node probe.mjs <relay port> <relay placeholder> <relay pid> <private dir>...
import fs from 'node:fs';
import net from 'node:net';
import dns from 'node:dns/promises';
import { execFileSync } from 'node:child_process';

const [relayPort, placeholder, relayPid, ...privateDirs] = process.argv.slice(2);
const works = (f) => { try { f(); return true; } catch { return false; } };
const connects = (opts) => new Promise((done) => {
  const s = net.connect({ ...opts, timeout: 3000 });
  s.on('connect', () => done(true)).on('error', () => done(false)).on('timeout', () => done(false)).on('close', () => s.destroy());
});
const owner = (pid) => { try { return fs.statSync(`/proc/${pid}`).uid; } catch { return process.getuid(); } };
const others = fs.readdirSync('/proc').filter((p) => /^\d+$/.test(p) && owner(p) !== process.getuid());
const read = (f) => { try { return fs.readFileSync(f, 'latin1'); } catch { return ''; } };
const TOKENISH = /gh[pousr]_[A-Za-z0-9]{30,}|sk-ant-[\w-]{20,}|x-access-token:|basic [A-Za-z0-9+/=]{40,}/i;
// Every listening TCP socket on this machine, at the address it listens on (0.0.0.0 is reached through 127.0.0.1).
const listeners = ['tcp', 'tcp6'].flatMap((v) => read(`/proc/net/${v}`).split('\n').slice(1).map((l) => l.trim().split(/\s+/))
  .filter((f) => f[3] === '0A').map(([, local]) => {
    const [hex, port] = local.split(':');
    const ip = v === 'tcp6' ? '::1' : hex.match(/../g).reverse().map((h) => parseInt(h, 16)).join('.').replace(/^0\.0\.0\.0$/, '127.0.0.1');
    return { host: ip, port: parseInt(port, 16) };
  })).filter((l) => !(l.host === '127.0.0.1' && l.port === Number(relayPort)));

const checks = {
  "another user's /proc/<pid>/environ": others.some((p) => works(() => fs.readFileSync(`/proc/${p}/environ`))),
  "the relay's memory": works(() => fs.closeSync(fs.openSync(`/proc/${relayPid}/mem`, 'r'))),
  'a token in any command line': others.some((p) => TOKENISH.test(read(`/proc/${p}/cmdline`))),
  'GitHub or Actions variables in my env': Object.keys(process.env).some((k) => /^(GITHUB|ACTIONS|GH|RUNNER)_/.test(k)),
  'sudo': works(() => execFileSync('sudo', ['-n', 'true'], { stdio: 'ignore' })),
  ...Object.fromEntries(privateDirs.map((d) => [`list ${d}`, works(() => fs.readdirSync(d))])),
  'the docker socket': await connects({ path: '/var/run/docker.sock' }),
  'cloud metadata 169.254.169.254:80': await connects({ host: '169.254.169.254', port: 80 }),
  'Azure wireserver 168.63.129.16:80': await connects({ host: '168.63.129.16', port: 80 }),
  'github.com 140.82.112.3:443': await connects({ host: '140.82.112.3', port: 443 }),
  'Cloudflare 1.1.1.1:443': await connects({ host: '1.1.1.1', port: 443 }),
  'IPv6 [2606:4700:4700::1111]:443': await connects({ host: '2606:4700:4700::1111', port: 443 }),
  'DNS lookup of github.com': await dns.resolve4('github.com').then(() => true, () => false),
  'git to github.com (push needs this first)': works(() => execFileSync('git', ['ls-remote', 'https://github.com/jarrodwatts/claude-hud', 'HEAD'],
    { stdio: 'ignore', timeout: 20000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })),
  'the relay off /v1/messages': await fetch(`http://127.0.0.1:${relayPort}/v1/models`, { headers: { authorization: `Bearer ${placeholder}` } })
    .then((r) => r.ok, () => false),
};
for (const l of listeners) checks[`local listener ${l.host}:${l.port}`] = await connects(l);

const reachable = Object.entries(checks).filter(([, hit]) => hit);
for (const [name, hit] of Object.entries(checks)) console.log(`${hit ? 'REACHABLE' : 'blocked  '} ${name}`);
console.log(`reach probe: ${reachable.length}/${Object.keys(checks).length} reachable`);
process.exit(reachable.length ? 1 : 0);
