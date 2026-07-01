import * as fs from 'node:fs';
import * as path from 'node:path';
import { createDebug } from './debug.js';
import type { SshTarget } from './types.js';

const debug = createDebug('ssh-targets');

/** Read at most this many bytes from the end of each transcript. */
const TAIL_BYTES = 1024 * 1024;
/** Show at most this many subagent sources. */
const MAX_SUBAGENTS = 3;
/** Never stat/read more than this many subagent files, newest first. */
const MAX_SUBAGENT_FILES = 20;
const DEFAULT_PORT = 22;

/**
 * ssh options that consume the following token as their value, so the value is
 * not mistaken for the destination host. `-p` is handled separately (port).
 */
const VALUE_OPTS = new Set([
  '-i', '-o', '-F', '-l', '-b', '-c', '-D', '-e', '-I', '-J',
  '-L', '-m', '-O', '-Q', '-R', '-S', '-W', '-w', '-B',
]);

interface HostPort {
  host: string;
  port: number;
}

function normalizePort(value: string): number {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : DEFAULT_PORT;
}

function isValidHost(host: string): boolean {
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)) {
    return host.split('.').every(octet => Number(octet) <= 255);
  }
  // Require at least one dot so bare command words / aliases are not treated as hosts.
  return /^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/.test(host);
}

function parseInvocation(args: string): HostPort | null {
  const tokens = args.split(/\s+/).filter(Boolean);
  let port = DEFAULT_PORT;

  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];

    if (tok === '-p' && tokens[i + 1] !== undefined) {
      port = normalizePort(tokens[i + 1]);
      i += 1;
      continue;
    }
    const attached = /^-p(\d{1,5})$/.exec(tok);
    if (attached) {
      port = normalizePort(attached[1]);
      continue;
    }
    if (VALUE_OPTS.has(tok)) {
      i += 1; // skip this option's value
      continue;
    }
    if (tok.startsWith('-')) {
      continue; // valueless flag (e.g. -t, -v) or attached option (e.g. -oFoo=bar)
    }

    // First non-option token is the [user@]host destination.
    const at = tok.lastIndexOf('@');
    const host = at >= 0 ? tok.slice(at + 1) : tok;
    return isValidHost(host) ? { host, port } : null;
  }

  return null;
}

/**
 * Parse the SSH destination from a single shell command string.
 *
 * Splits on shell separators and inspects each segment so `echo ssh x` and
 * remote-command arguments are not misread as an ssh invocation. Requires
 * whitespace after `ssh`, so `ssh-keygen`/`ssh-add` are excluded. Returns the
 * LAST ssh target on the line (most recent), or null when there is none.
 */
export function extractSshTarget(command: string): HostPort | null {
  if (typeof command !== 'string' || !command.includes('ssh')) {
    return null;
  }

  const segments = command.split(/&&|\|\||[;|&()`\n]|\$\(/);
  let result: HostPort | null = null;

  for (const segment of segments) {
    let seg = segment.trim();
    if (!seg) continue;
    // Strip leading env assignments / sudo / env so `sudo ssh host` still matches.
    seg = seg.replace(/^(?:sudo\s+|env\s+|[A-Za-z_][A-Za-z0-9_]*=\S+\s+)+/, '');
    const m = /^ssh\s+(.+)$/i.exec(seg);
    if (!m) continue;
    const target = parseInvocation(m[1]);
    if (target) result = target;
  }

  return result;
}

function readTail(file: string): string {
  let fd: number | null = null;
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return '';
    const size = st.size;
    const start = size > TAIL_BYTES ? size - TAIL_BYTES : 0;
    const len = size - start;
    if (len <= 0) return '';
    fd = fs.openSync(file, 'r');
    const buf = Buffer.allocUnsafe(len);
    fs.readSync(fd, buf, 0, len, start);
    return buf.toString('utf8');
  } catch (err) {
    debug('tail read failed for %s: %s', file, err instanceof Error ? err.message : err);
    return '';
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
  }
}

function bashCommandsFromEntry(entry: unknown): string[] {
  const commands: string[] = [];
  const content = (entry as { message?: { content?: unknown } })?.message?.content;
  if (!Array.isArray(content)) return commands;
  for (const block of content) {
    if (
      block
      && typeof block === 'object'
      && (block as { type?: unknown }).type === 'tool_use'
      && (block as { name?: unknown }).name === 'Bash'
      && typeof (block as { input?: { command?: unknown } }).input?.command === 'string'
    ) {
      commands.push((block as { input: { command: string } }).input.command);
    }
  }
  return commands;
}

/** Most-recent ssh target seen in a single transcript file (tail only). */
function lastSshInFile(file: string): HostPort | null {
  const text = readTail(file);
  if (!text || !text.includes('ssh')) return null;

  let result: HostPort | null = null;
  // A tail read can cut the first line mid-JSON; JSON.parse simply fails on it.
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }
    for (const command of bashCommandsFromEntry(entry)) {
      const target = extractSshTarget(command);
      if (target) result = target;
    }
  }
  return result;
}

/** `<dir>/<sid>.jsonl` → `<dir>/<sid>/subagents` */
function subagentsDir(transcriptPath: string): string {
  const parsed = path.parse(transcriptPath);
  return path.join(parsed.dir, parsed.name, 'subagents');
}

/** `agent-<id>.jsonl` → `<id>` */
function agentIdFromFile(name: string): string {
  const m = /^agent-(.+)\.jsonl$/i.exec(name);
  return m ? m[1] : name.replace(/\.jsonl$/i, '');
}

interface AgentFile {
  name: string;
  path: string;
  mtimeMs: number;
}

function listAgentFiles(dir: string): AgentFile[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: AgentFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
    const full = path.join(dir, entry.name);
    try {
      files.push({ name: entry.name, path: full, mtimeMs: fs.statSync(full).mtimeMs });
    } catch { /* skip unreadable */ }
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files.slice(0, MAX_SUBAGENT_FILES);
}

function safeMtime(file: string): number {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Collect session-scoped SSH targets for the HUD: the main agent's most recent
 * target (from `transcriptPath`) followed by up to three subagents' most recent
 * targets (from `<sid>/subagents/*.jsonl`), most recently active first. Returns
 * one entry per source; empty when nothing is found. All fs access is guarded so
 * a missing transcript or subagents dir degrades gracefully.
 */
export function collectSshTargets(transcriptPath: string): SshTarget[] {
  const out: SshTarget[] = [];
  if (!transcriptPath) return out;

  try {
    const mainTarget = lastSshInFile(transcriptPath);
    if (mainTarget) {
      out.push({ ...mainTarget, source: 'main', lastSeen: safeMtime(transcriptPath) });
    }
  } catch (err) {
    debug('main scan failed: %s', err instanceof Error ? err.message : err);
  }

  try {
    let count = 0;
    for (const file of listAgentFiles(subagentsDir(transcriptPath))) {
      if (count >= MAX_SUBAGENTS) break;
      const target = lastSshInFile(file.path);
      if (target) {
        out.push({
          ...target,
          source: 'subagent',
          agentId: agentIdFromFile(file.name),
          lastSeen: file.mtimeMs,
        });
        count += 1;
      }
    }
  } catch (err) {
    debug('subagent scan failed: %s', err instanceof Error ? err.message : err);
  }

  return out;
}
