// `hud install`: points Claude Code's statusLine at claude-hud, using the runtime running this. A
// capability, so it runs outside the cage, and the skill never pre-approves it: Claude Code asks
// the user first. Plugins can't set statusLine themselves, so this writes the user's settings.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHELLS = ['posix', 'gitbash', 'powershell'];
const LAUNCHER = fileURLToPath(new URL('./scripts/statusline.mjs', import.meta.url));

// Claude Code runs statusLine through bash on macOS, Linux and WSL. On Windows it uses Git Bash
// when installed (which sets MSYSTEM for the commands Claude runs), otherwise PowerShell.
export function detectShell(env = process.env, platform = process.platform) {
  if (platform !== 'win32') return 'posix';
  return env.MSYSTEM || /bash/i.test(env.SHELL ?? '') ? 'gitbash' : 'powershell';
}

const quote = (value) => `'${value.replaceAll("'", `'\\''`)}'`;

function buildCommand(shell, launcher, env = process.env) {
  if (shell === 'gitbash') {
    // Launch through cmd.exe: Git Bash creates native children suspended, so a
    // killed statusLine shell would otherwise strand a node.exe (#747).
    return 'exec "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/claude-hud/statusline.cmd"';
  }
  if (shell === 'powershell') {
    const cmd = path.win32.join(env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe');
    return `${cmd} /d /s /c ""${process.execPath}" "${launcher}""`;
  }
  return `${quote(process.execPath)} ${quote(launcher)}`;
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

/**
 * Copies the launcher next to the HUD's config and writes statusLine, keeping every other setting.
 * Refuses to replace another tool's status line unless `replace` is set; the old command is kept.
 * argv: [--shell posix|gitbash|powershell] [--replace]
 */
export function install({ configDir, argv = [], env = process.env }) {
  const flag = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const shell = flag('--shell') ?? detectShell(env);
  if (!SHELLS.includes(shell)) throw new Error(`--shell must be one of ${SHELLS.join(', ')}`);

  const hudDir = path.join(configDir, 'plugins', 'claude-hud');
  const launcher = path.join(hudDir, 'statusline.mjs');
  const settingsPath = path.join(configDir, 'settings.json');
  const settings = readSettings(settingsPath);
  const command = buildCommand(shell, launcher, env);
  const existing = typeof settings.statusLine?.command === 'string' ? settings.statusLine.command : '';
  const replaced = existing === '' ? 'none' : existing.includes('claude-hud') ? 'claude-hud' : 'other';
  if (replaced === 'other' && !argv.includes('--replace')) {
    throw new Error('statusLine already runs another command. Ask the user, then run install --replace (settings.json is backed up first).');
  }
  const report = { settingsPath, shell, command, replaced };

  fs.mkdirSync(hudDir, { recursive: true });
  fs.copyFileSync(LAUNCHER, launcher);
  if (shell === 'gitbash') {
    fs.writeFileSync(path.join(hudDir, 'statusline.cmd'), `@echo off\r\n"${process.execPath}" "%~dp0statusline.mjs"\r\n`);
  }
  if (fs.existsSync(settingsPath)) {
    report.backupPath = `${settingsPath}.bak.${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '')}`;
    fs.copyFileSync(settingsPath, report.backupPath);
  }
  if (replaced === 'other') {
    report.previousCommandPath = path.join(hudDir, 'previous-statusline.txt');
    fs.writeFileSync(report.previousCommandPath, existing, { mode: 0o600 });
  }

  const statusLine = { ...(replaced === 'claude-hud' ? settings.statusLine : {}), type: 'command', command };
  // Write the real file (settings.json is often a dotfiles symlink) and keep its permissions.
  const target = fs.existsSync(settingsPath) ? fs.realpathSync(settingsPath) : settingsPath;
  const mode = fs.existsSync(target) ? fs.statSync(target).mode & 0o777 : 0o600;
  const temp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify({ ...settings, statusLine }, null, 2)}\n`, { mode });
  fs.chmodSync(temp, mode);
  fs.renameSync(temp, target);
  return report;
}
