// Installs the claude-hud statusLine. Run under the runtime the status line
// should use (node, or bun on macOS/Linux):
//   <runtime> setup.mjs inspect --shell posix|gitbash|powershell
//   <runtime> setup.mjs install --shell posix|gitbash|powershell [--refresh-interval N]
// Both print a JSON report on stdout.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHELLS = ['posix', 'gitbash', 'powershell'];

function configDir() {
  const dir = process.env.CLAUDE_CONFIG_DIR?.trim();
  if (!dir) return path.join(os.homedir(), '.claude');
  return dir === '~' || dir.startsWith('~/') ? path.join(os.homedir(), dir.slice(1)) : dir;
}

const quote = (value) => `'${value.replaceAll("'", `'\\''`)}'`;

function buildCommand(shell, launcher) {
  if (shell === 'gitbash') {
    // Launch through cmd.exe: Git Bash creates native children suspended, so a
    // killed statusLine shell would otherwise strand a node.exe (#747).
    return 'exec "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/claude-hud/statusline.cmd"';
  }
  if (shell === 'powershell') {
    const cmd = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe');
    return `${cmd} /d /s /c ""${process.execPath}" "${launcher}""`;
  }
  const bunFlags = process.versions.bun ? ' --env-file /dev/null' : '';
  return `${quote(process.execPath)}${bunFlags} ${quote(launcher)}`;
}

function readSettings(file) {
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  if (text.trim() === '') return {};
  const settings = JSON.parse(text);
  if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error(`${file} does not contain a JSON object`);
  }
  return settings;
}

function redact(command) {
  const preview = command
    .replace(/\b(Bearer)\s+["']?[^"'\s]+/gi, '$1 [REDACTED]')
    .replace(/\b(Authorization\s*:\s*)["']?[^"'\s]+/gi, '$1[REDACTED]')
    .replace(/\b(token|api[_-]?key|secret|password|pass|auth)(=|:)\s*["']?[^"'\s]+/gi, '$1$2[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-[REDACTED]')
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{8,}\b/g, '[GITHUB_TOKEN_REDACTED]')
    .replace(/\s+/g, ' ')
    .trim();
  return preview.length > 160 ? `${preview.slice(0, 157)}...` : preview;
}

function main(argv) {
  const [action, ...rest] = argv;
  const flag = (name) => {
    const i = rest.indexOf(name);
    return i === -1 ? undefined : rest[i + 1];
  };
  const shell = flag('--shell');
  if (!['inspect', 'install'].includes(action) || !SHELLS.includes(shell)) {
    throw new Error('usage: setup.mjs inspect|install --shell posix|gitbash|powershell [--refresh-interval N]');
  }

  const hudDir = path.join(configDir(), 'plugins', 'claude-hud');
  const launcher = path.join(hudDir, 'statusline.mjs');
  const settingsPath = path.join(configDir(), 'settings.json');
  const settings = readSettings(settingsPath);
  const command = buildCommand(shell, launcher);
  const existing = typeof settings.statusLine?.command === 'string' ? settings.statusLine.command : '';
  const existingKind = existing === '' ? 'none' : existing.includes('claude-hud') ? 'claude-hud' : 'other';
  const report = { settingsPath, command, existing: existingKind, existingPreview: existing ? redact(existing) : '' };
  if (action === 'inspect') return report;

  fs.mkdirSync(hudDir, { recursive: true });
  fs.copyFileSync(fileURLToPath(new URL('./statusline.mjs', import.meta.url)), launcher);
  if (shell === 'gitbash') {
    fs.writeFileSync(path.join(hudDir, 'statusline.cmd'), `@echo off\r\n"${process.execPath}" "%~dp0statusline.mjs"\r\n`);
  }

  if (fs.existsSync(settingsPath)) {
    report.backupPath = `${settingsPath}.bak.${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '')}`;
    fs.copyFileSync(settingsPath, report.backupPath);
  }
  if (existingKind === 'other') {
    report.previousCommandPath = path.join(hudDir, 'previous-statusline.txt');
    fs.writeFileSync(report.previousCommandPath, existing, { mode: 0o600 });
  }

  const statusLine = { ...(existingKind === 'claude-hud' ? settings.statusLine : {}), type: 'command', command };
  const refresh = flag('--refresh-interval');
  if (refresh !== undefined) {
    const seconds = Math.floor(Number(refresh));
    if (seconds >= 1) statusLine.refreshInterval = seconds;
    else delete statusLine.refreshInterval;
  }
  // Write the real file (settings.json is often a dotfiles symlink) and keep its permissions.
  const target = fs.existsSync(settingsPath) ? fs.realpathSync(settingsPath) : settingsPath;
  const mode = fs.existsSync(target) ? fs.statSync(target).mode & 0o777 : 0o600;
  const temp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify({ ...settings, statusLine }, null, 2)}\n`, { mode });
  fs.chmodSync(temp, mode);
  fs.renameSync(temp, target);
  return report;
}

try {
  process.stdout.write(`${JSON.stringify(main(process.argv.slice(2)), null, 2)}\n`);
} catch (error) {
  process.stderr.write(`claude-hud setup: ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
}
