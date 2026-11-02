import * as fs from "node:fs";
import * as path from "node:path";
import type { Answers, Facts, Input, Output, Paths } from "./channel.ts";
import { checkValue, configKey, configKeys, mergeConfig, mergeOverrides, type HudConfig, type LoadedConfig } from "./config.ts";
import { stripAnsi, textWidth } from "./render/ansi.ts";
import { schemaLines } from "./schema.ts";
import type { StdinData } from "./types.ts";
import type { Sources } from "./main.ts";

// The /hud skill's subcommands, run in the cage like a render. Each answers with lines for the
// user's Claude to read; `set` also hands back the config for collector.mjs to write.
//   doctor                      facts, then findings, each naming its fix
//   schema [words]              config keys and notes matching the words
//   preview [--set k=v]... [--state json] [--width n] [--last]
//   set k=v...                  validated; `set --undo` is handled by hud.mjs
//   report [--note text] [--expect word]...   a scrubbed case for an issue

type Render = (stdin: StdinData, config: HudConfig, sources: Sources) => Promise<Output>;
type Raw = Record<string, unknown>;

const isObject = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);
const json = (value: unknown): string[] => JSON.stringify(value, null, 2).split("\n");
const fail = (lines: string[]): Output => ({ lines, failed: true });
const noFacts = async (): Promise<Answers> => ({});

// `--name value` and repeated flags; everything else is a positional word.
function parseArgs(args: string[]): { flags: Map<string, string[]>; words: string[] } {
  const flags = new Map<string, string[]>();
  const words: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      words.push(arg);
      continue;
    }
    const takesValue = i + 1 < args.length && !args[i + 1].startsWith("--");
    flags.set(arg, [...(flags.get(arg) ?? []), takesValue ? args[++i] : ""]);
  }
  return { flags, words };
}

function setPath(target: Raw, key: string, value: unknown): void {
  const parts = key.split(".");
  let node = target;
  for (const part of parts.slice(0, -1)) {
    if (!isObject(node[part])) node[part] = {};
    node = node[part] as Raw;
  }
  node[parts.at(-1)!] = value;
}

const getPath = (source: unknown, key: string): unknown => key.split(".").reduce<unknown>((node, part) => (isObject(node) ? node[part] : undefined), source);

// `true`, `42`, `["a","b"]` and `"quoted"` are JSON; anything else is taken as text.
function parseValue(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// These name files outside the cage that the collector reads or writes, so only the user's own edit sets them.
const FILE_KEYS = ["display.externalUsagePath", "display.externalUsageWritePath"];

/** Validates `key=value` pairs. Returns the problems, or the pairs ready to apply. */
function parseAssignments(pairs: string[]): { problems: string[]; assignments: Array<[string, unknown]> } {
  const problems: string[] = [];
  const assignments: Array<[string, unknown]> = [];
  for (const pair of pairs) {
    const at = pair.indexOf("=");
    if (at <= 0) {
      problems.push(`${JSON.stringify(pair)} is not key=value`);
      continue;
    }
    const key = pair.slice(0, at).trim();
    const value = parseValue(pair.slice(at + 1));
    if (FILE_KEYS.includes(key)) {
      problems.push(`${key} names a file the HUD reads or writes, so only the user sets it, by editing config.json`);
      continue;
    }
    const problem = checkValue(key, value);
    if (problem) problems.push(problem);
    else assignments.push([key, value]);
  }
  return { problems, assignments };
}

// ---- doctor

// The statusLine command can hold tokens, so the user's Claude only ever sees this.
function redact(command: string): string {
  const preview = command
    .replace(/\b(Bearer)\s+["']?[^"'\s]+/gi, "$1 [REDACTED]")
    .replace(/\b(Authorization\s*:\s*)["']?[^"'\s]+/gi, "$1[REDACTED]")
    .replace(/\b(token|api[_-]?key|secret|password|pass|auth)(=|:)\s*["']?[^"'\s]+/gi, "$1$2[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "sk-[REDACTED]")
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{8,}\b/g, "[GITHUB_TOKEN_REDACTED]")
    .replace(/\s+/g, " ")
    .trim();
  return preview.length > 160 ? `${preview.slice(0, 157)}...` : preview;
}

function readJson(file: string): Raw | null {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

// Claude Code's own settings, highest precedence first. Managed policy settings aren't read.
function settingsFiles({ project, user }: Paths): Array<{ scope: string; file: string }> {
  return [
    ...(project ? [{ scope: "local", file: project.localSettings }] : []),
    ...(project?.settings ? [{ scope: "project", file: project.settings }] : []),
    { scope: "user", file: user.settings },
  ];
}

function doctor(facts: Facts, paths: Paths, loaded: LoadedConfig, now: number): Output {
  const settings = settingsFiles(paths).map(entry => ({ ...entry, value: readJson(entry.file) }));
  const statusSource = settings.find(entry => isObject(entry.value?.statusLine));
  const statusLine = statusSource?.value?.statusLine as Raw | undefined;
  const command = typeof statusLine?.command === "string" ? statusLine.command : "";
  const kind = !command ? "none" : command.includes("claude-hud") ? "claude-hud" : "other";
  // The highest-precedence file that sets it decides, as in Claude Code.
  const hooksSetting = settings.find(entry => typeof entry.value?.disableAllHooks === "boolean");
  const hooksOff = hooksSetting?.value?.disableAllHooks === true ? hooksSetting : undefined;
  const beat = facts.heartbeat;

  const findings: string[] = [];
  if (kind === "none") findings.push("No statusLine is set. Fix: `hud install`.");
  if (kind === "other") findings.push(`statusLine runs another command (${redact(command)}). Fix: ask the user, then \`hud install --replace\`.`);
  if (hooksOff) findings.push(`disableAllHooks is true in ${hooksOff.scope} settings (${hooksOff.file}), which also turns the status line off. Fix: ask the user before changing it.`);
  if (kind === "claude-hud" && !beat) findings.push("Claude Code hasn't run the HUD yet. Fix: send any message; if it stays blank, `hud install` again.");
  if (beat?.outcome === "upgrade") {
    findings.push(`Claude Code runs the HUD on ${beat.runtime} (${beat.path}), which is too old. Fix: run \`hud install\` with a Node 22.18+ from runtimes, or install one.`);
  } else if (beat && beat.outcome !== "ok") {
    findings.push(`The last render failed: ${beat.outcome}`);
  }
  findings.push(...loaded.problems.map(problem => `${problem}. Fix: \`hud set\` a valid value (\`hud schema <key>\` says what it takes).`));

  return {
    lines: json({
      runtime: facts.runtime,
      plugin: facts.plugin,
      lastRender: beat
        ? { secondsAgo: Math.round((now - beat.at) / 1000), runtime: beat.runtime, path: beat.path, outcome: beat.outcome, columns: beat.columns }
        : null,
      statusLine: statusSource ? { scope: statusSource.scope, file: statusSource.file, kind, command: redact(command) } : { kind: "none" },
      config: { path: facts.configPath, problems: loaded.problems },
      runtimes: facts.runtimes,
      findings: findings.length > 0 ? findings : ["None. The HUD is set up and rendering."],
    }),
  };
}

// ---- preview

// A plausible session, for previews before any real render.
const SAMPLE: StdinData = {
  cwd: "/home/user/my-project",
  model: { id: "claude-opus-5-5", display_name: "Opus 5.5" },
  version: "2.1.310",
  context_window: {
    context_window_size: 200_000, used_percentage: 45, remaining_percentage: 55, total_input_tokens: 90_000, total_output_tokens: 1_200,
    current_usage: { input_tokens: 8_000, output_tokens: 1_200, cache_creation_input_tokens: 2_000, cache_read_input_tokens: 80_000 },
  },
  cost: { total_cost_usd: 1.23, total_duration_ms: 3_600_000, total_api_duration_ms: 600_000, total_lines_added: 156, total_lines_removed: 23 },
};

function mergeDeep(base: unknown, patch: unknown): unknown {
  if (!isObject(base) || !isObject(patch)) return patch;
  return Object.fromEntries([...new Set([...Object.keys(base), ...Object.keys(patch)])]
    .map(key => [key, key in patch ? mergeDeep(base[key], patch[key]) : base[key]]));
}

// Its own data dir, so a preview never touches the real cost ledger or caches.
function scratchDir(dataDir: string): string {
  const dir = path.join(dataDir, "preview");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function preview(input: Input, facts: Facts, loaded: LoadedConfig, render: Render, ask: Sources["ask"]): Promise<Output> {
  const { flags } = parseArgs(input.command!.args);
  const { problems, assignments } = parseAssignments(flags.get("--set") ?? []);
  if (problems.length > 0) return fail(problems);
  const last = flags.has("--last");
  if (last && !facts.heartbeat?.stdin) return fail(["No real render to replay yet: Claude Code hasn't run the HUD since it was installed."]);

  let state: unknown = {};
  try {
    state = JSON.parse(flags.get("--state")?.at(-1) || "{}");
  } catch {
    return fail(["--state must be JSON, such as '{\"context_window\":{\"used_percentage\":90}}'"]);
  }
  const width = Number(flags.get("--width")?.at(-1) ?? facts.heartbeat?.columns ?? 100);
  if (!Number.isInteger(width) || width < 10 || width > 1000) return fail(["--width must be a whole number from 10 to 1000"]);

  const base = structuredClone(loaded.base);
  for (const [key, value] of assignments) setPath(base, key, value);
  const config = mergeConfig(mergeOverrides(base, loaded.override) as Partial<HudConfig>);
  const stdin = mergeDeep(last ? facts.heartbeat!.stdin : SAMPLE, state) as StdinData;
  const output = await render(stdin, config, { ask: last ? ask : noFacts, files: last, paths: input.paths, dataDir: scratchDir(input.paths.data), now: input.now, columns: width });
  return { lines: [`Preview at ${width} columns, ${last ? "replaying the last real render" : "with a sample session"}:`, ...output.lines.map(stripAnsi)] };
}

// ---- set

function set(input: Input, loaded: LoadedConfig): Output {
  const pairs = input.command!.args;
  if (pairs.length === 0) return fail(["Usage: hud set key=value [key=value...], or hud set --undo"]);
  // Writing over a file we couldn't read would drop whatever is in it.
  if (loaded.baseUnreadable) return fail([`${loaded.baseUnreadable}, so set would lose what is in it. Fix or move it first. Nothing was changed.`]);
  const { problems, assignments } = parseAssignments(pairs);
  if (problems.length > 0) return fail([...problems, "Nothing was changed."]);
  const config = structuredClone(loaded.base);
  const lines = assignments.map(([key, value]) => {
    const was = getPath(mergeOverrides(loaded.base, loaded.override), key);
    setPath(config, key, value);
    const shadowed = getPath(loaded.override, key) !== undefined ? " claude-hud.json also sets it, and its value wins." : "";
    return `Set ${key} = ${JSON.stringify(value)} (was ${JSON.stringify(was ?? configKey(key)?.default)}).${shadowed}`;
  });
  return { lines: [...lines, "`hud set --undo` puts it back."], config };
}

// ---- report

// Masked text keeps its width, so layout bugs still show: each cell becomes x, a wide one 全.
// Path separators stay, because the project name is the last path segment.
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export const mask = (text: string): string => [...GRAPHEMES.segment(text)]
  .map(({ segment }) => (segment === "/" || segment === "\\" ? segment : textWidth(segment) >= 2 ? "全" : "x".repeat(textWidth(segment))))
  .join("");

// The only stdin text a report keeps. Numbers, booleans and null carry no words and stay; every
// other string is masked.
const KEPT_TEXT = new Set(["version", "model.id", "model.display_name", "effort.level", "prompt_cache.ttl", "workspace.repo.host"]);

export function scrubStdin(value: unknown, at = ""): unknown {
  if (Array.isArray(value)) return value.map(item => scrubStdin(item, `${at}.*`));
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrubStdin(item, at ? `${at}.${key}` : key)]));
  return typeof value === "string" && !KEPT_TEXT.has(at) ? mask(value) : value;
}

/** The keys that differ from the defaults, with the user's own words masked. */
export function scrubConfig(config: HudConfig): Raw {
  const out: Raw = {};
  for (const entry of configKeys()) {
    const value = getPath(config, entry.key);
    if (JSON.stringify(value) === JSON.stringify(entry.default)) continue;
    setPath(out, entry.key, entry.freeText && typeof value === "string" ? mask(value) : value);
  }
  return out;
}

// The case vocabulary (verify/case.mjs EXPECT); the maintainer rejects any other word.
const EXPECT_WORDS = [/^exit 0$/, /^finishes within \d+ms$/, /^at most \d+ lines$/, /^no line wider than columns$/,
  /^every line closes its OSC 8 link$/, /^only safe escapes$/, /^no lone surrogate$/, /^contains .+$/s, /^lacks .+$/s];
const ALWAYS_EXPECTED = ["exit 0", "only safe escapes", "no line wider than columns", "every line closes its OSC 8 link"];

async function report(input: Input, facts: Facts, loaded: LoadedConfig, render: Render): Promise<Output> {
  const beat = facts.heartbeat;
  if (!beat?.stdin) return fail(["No render to report yet: Claude Code hasn't run the HUD since it was installed. Use `hud doctor`."]);
  const { flags } = parseArgs(input.command!.args);
  const wanted = flags.get("--expect") ?? [];
  const unknown = wanted.filter(word => !EXPECT_WORDS.some(pattern => pattern.test(word)));
  if (unknown.length > 0) return fail([`Not in the case vocabulary: ${unknown.map(word => JSON.stringify(word)).join(", ")}`]);

  const stdin = scrubStdin(beat.stdin) as StdinData;
  const config = scrubConfig(loaded.config);
  const columns = beat.columns ?? 100;
  const testCase = {
    note: flags.get("--note")?.join(" ") ?? "",
    columns,
    stdin,
    expect: [...new Set([...ALWAYS_EXPECTED, ...wanted])],
    config,
    versions: { claudeCode: typeof beat.stdin.version === "string" ? beat.stdin.version : null, node: beat.runtime, hud: facts.plugin.version },
    platform: process.platform,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    now: new Date(beat.at).toISOString(),
  };
  // What the maintainer will see from this case: the scrubbed input alone, no files or programs.
  const actual = await render(stdin, mergeConfig(config as Partial<HudConfig>), {
    ask: noFacts, files: false, paths: input.paths, dataDir: scratchDir(input.paths.data), now: beat.at, columns,
  });
  return { lines: json({ case: testCase, actual: actual.lines.map(stripAnsi) }) };
}

// ---- dispatch

export async function runCommand(input: Input, loaded: LoadedConfig, render: Render, ask: Sources["ask"]): Promise<Output> {
  const { name, args, facts } = input.command!;
  switch (name) {
    case "doctor": return doctor(facts, input.paths, loaded, input.now);
    case "schema": return { lines: schemaLines(args) };
    case "preview": return preview(input, facts, loaded, render, ask);
    case "set": return set(input, loaded);
    case "report": return report(input, facts, loaded, render);
    default: return fail([`Unknown command ${name}`]);
  }
}
