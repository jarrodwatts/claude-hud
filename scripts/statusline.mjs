// Runs the newest installed claude-hud. /claude-hud:setup copies this file to
// <config dir>/plugins/claude-hud/ so the statusLine command survives updates.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Claude Code pads the status line by 2 columns on each side.
const columns = Number.parseInt(process.env.COLUMNS ?? '', 10);
if (columns > 0) process.env.COLUMNS = String(Math.max(1, columns - 4));

const envDir = process.env.CLAUDE_CONFIG_DIR?.trim();
const configDir = !envDir
  ? path.join(os.homedir(), '.claude')
  : envDir === '~' || envDir.startsWith('~/') ? path.join(os.homedir(), envDir.slice(1)) : envDir;
const cacheDir = path.join(configDir, 'plugins', 'cache');
const entry = process.versions.bun ? path.join('src', 'index.ts') : path.join('dist', 'index.js');

const list = (dir) => {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
};
const parseVersion = (name) => /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(name)?.slice(1).map(Number);
const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

let latest;
for (const marketplace of list(cacheDir)) {
  const pluginDir = path.join(cacheDir, marketplace, 'claude-hud');
  for (const name of list(pluginDir)) {
    const version = parseVersion(name);
    const file = path.join(pluginDir, name, entry);
    if (version && (!latest || compare(version, latest.version) > 0) && fs.existsSync(file)) {
      latest = { version, file };
    }
  }
}

if (latest) {
  const hud = await import(pathToFileURL(latest.file).href);
  await hud.main();
}
