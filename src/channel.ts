import * as fs from 'node:fs';
import type { StdinData } from './types.ts';

// Logic runs caged and talks to hud.mjs over raw descriptors, one JSON message per line:
//
//   hud ─▶ logic   {stdin, now, paths, command?}   once, first
//   logic ─▶ hud   {id, ask: ['git.status', …]}    any number; names from createProbes in collector.mjs
//   hud ─▶ logic   {id, answers: {…}}              the probes' answers: a case's `facts` are these, recorded
//   logic ─▶ hud   {lines, snapshot?, config?, failed?}   last
//
// The fence takes away the stdio streams, so fd 0 is read with fs.

/**
 * Every file logic may read, named by logicPaths in collector.mjs, which grants exactly these.
 * Logic works out no path of its own. A null project means stdin had no usable cwd.
 */
export interface Paths {
  /** The one directory logic may write. */
  data: string;
  config: string;
  override: string;
  heartbeat: string;
  claudeJson: string;
  user: { claudeMd: string; rules: string; settings: string };
  /** dotClaudeMd, rules and settings are null when the project's .claude is the user's config dir. */
  project: {
    claudeMd: string; localMd: string; mcpJson: string; dotClaudeMd: string | null; dotLocalMd: string;
    rules: string | null; settings: string | null; localSettings: string;
  } | null;
  transcript: string | null;
  subagents: string | null;
}

export interface Input {
  stdin: StdinData | null;
  /** The render's one clock reading, taken by hud.mjs so a replayed input renders the same. */
  now: number;
  paths: Paths;
  /** A `hud <name> …` subcommand instead of a render, with the facts hud.mjs gathered for it. */
  command?: { name: string; args: string[]; facts: Facts };
}

/** What hud.mjs knows that logic can't look up from inside the cage. See commandFacts in collector.mjs. */
export interface Facts {
  runtime: { name: string; version: string; path: string; supported: boolean };
  runtimes: Array<{ manager: string; version: string; path: string; supported: boolean | null }>;
  plugin: { root: string; version: string | null };
  configPath: string;
  undoPath: string;
  cwd: string;
  /** The last render Claude Code ran, written by hud.mjs: when, on what, how it went, and its input. */
  heartbeat: { at: number; runtime: string; path: string; outcome: string; columns: number | null; stdin: StdinData | null } | null;
}

export type Probe = 'git.status' | 'git.numstat' | 'git.branch' | 'git.describe' | 'jj' | 'memory' | 'extra' | 'usage.read' | 'usage.target';
export type Answers = Partial<Record<Probe, unknown>>;
export type Ask = (probes: Probe[]) => Promise<Answers>;

export interface Output {
  lines: string[];
  snapshot?: unknown;
  /** From `hud set`: the whole new config.json, which collector.mjs writes. */
  config?: Record<string, unknown>;
  /** A subcommand that refused or failed; hud.mjs exits 1. */
  failed?: boolean;
}

let input: ((value: Input) => void) | undefined;
const waiting = new Map<number, (answers: Answers) => void>();
let nextId = 0;

function send(message: unknown): void {
  const bytes = Buffer.from(`${JSON.stringify(message)}\n`);
  for (let written = 0; written < bytes.length;) written += fs.writeSync(1, bytes, written);
}

function receive(line: string): void {
  const message = JSON.parse(line) as { id?: number; answers?: Answers } & Input;
  if (typeof message.id === 'number') {
    waiting.get(message.id)?.(message.answers ?? {});
    waiting.delete(message.id);
  } else {
    input?.(message);
    input = undefined;
  }
}

// Reads until hud closes fd 0, which it does once it has the output.
function readLoop(): void {
  const chunk = Buffer.alloc(64 * 1024);
  let pending = Buffer.alloc(0);
  const next = (): void => fs.read(0, chunk, 0, chunk.length, null, (error, bytesRead) => {
    if (error || bytesRead === 0) return;
    pending = Buffer.concat([pending, chunk.subarray(0, bytesRead)]);
    for (let newline = pending.indexOf(10); newline !== -1; newline = pending.indexOf(10)) {
      receive(pending.subarray(0, newline).toString('utf8'));
      pending = pending.subarray(newline + 1);
    }
    next();
  });
  next();
}

export function open(): Promise<Input> {
  const first = new Promise<Input>((resolve) => { input = resolve; });
  readLoop();
  return first;
}

export const ask: Ask = (probes) => new Promise((resolve) => {
  const id = nextId++;
  waiting.set(id, resolve);
  send({ id, ask: probes });
});

export function finish(output: Output): void {
  send(output);
}
