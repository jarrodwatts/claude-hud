import { ask, finish, open, type Ask, type Output, type Paths, type Probe } from "./channel.ts";
import { getUsageFromStdin, isContextUnreported } from "./stdin.ts";
import { addSubagentEfforts, parseTranscript } from "./transcript.ts";
import { renderLines } from "./render/index.ts";
import { shownAgents } from "./render/activity.ts";
import { countConfigs, type ConfigCounts } from "./config-reader.ts";
import { getGitStatus, type GitRepoIdentity, type GitStatus } from "./git.ts";
import { getJjStatus } from "./jj.ts";
import { loadConfigFiles, type HudConfig } from "./config.ts";
import { extraCmdLabel } from "./extra-cmd.ts";
import { getMemoryUsage, readMemory, type MemoryFacts } from "./memory.ts";
import { readAuthInfo } from "./auth.ts";
import { getCostTotals } from "./daily-cost.ts";
import { getOutputSpeed } from "./speed.ts";
import { externalUsageSnapshot, resolveUsage, type UsageTarget } from "./external-usage.ts";
import { getTerminalWidth } from "./utils/terminal.ts";
import { truncateToWidth, visibleWidth } from "./render/ansi.ts";
import { setLanguage, t } from "./i18n/index.ts";
import type { StdinData, TranscriptData } from "./types.ts";

// The caged half of a render. hud.mjs starts this under node --permission with fence.mjs loaded,
// hands it the stdin payload, runs the probes it asks for, and prints the lines it returns. For a
// `hud <command>` it gets the command instead (see commands.ts).

const EMPTY_TRANSCRIPT: TranscriptData = { tools: [], skills: [], mcpServers: [], mcpErrors: [], agents: [], todos: [] };
const NO_COUNTS: ConfigCounts = { claudeMdCount: 0, rulesCount: 0, mcpCount: 0, hooksCount: 0 };

function needsTranscript(config: HudConfig, stdin: StdinData): boolean {
  const d = config.display;
  return d.showTools || d.showSkills || d.showMcp || d.showAgents || d.showTodos
    || d.showConfigCounts || d.showSessionTokens || d.showCompactions || d.showAdvisor
    || d.showSessionStartDate || d.showLastResponseAt || d.showEffortLevel
    || d.modelSource !== "stdin"
    || isContextUnreported(stdin);
}

// jj wins in a repo that has one and opts in; git is the fallback when the jj probe fails.
async function resolveVcsStatus(
  config: HudConfig,
  ask: Ask,
  cwd?: string,
  repo?: GitRepoIdentity | null,
): Promise<GitStatus | null> {
  if (!cwd) return null;
  if (config.jjStatus.enabled) {
    const jjStatus = await getJjStatus(ask);
    if (jjStatus) return jjStatus;
  }
  return config.gitStatus.enabled
    ? getGitStatus(ask, { lineDiffs: config.gitStatus.showFileStats, repo })
    : null;
}

/** Where a render's inputs come from. `files: false` renders from stdin alone, as a report's case does. */
export interface Sources {
  ask: Ask;
  files: boolean;
  /** What logic may read, from collector.mjs. */
  paths: Paths;
  /** Where this render keeps state: paths.data, or a scratch dir for a preview. */
  dataDir: string;
  now: number;
  columns: number | null;
}

export async function renderStdin(stdin: StdinData, config: HudConfig, { ask, files, paths, dataDir, now, columns }: Sources): Promise<Output> {
  // Labels follow the config being rendered, which for a preview isn't the saved one.
  setLanguage(config.language);
  const display = config.display;
  const stdinUsage = getUsageFromStdin(stdin);
  const facts: Probe[] = ["extra"];
  if (display.showMemoryUsage && config.lineLayout === "expanded") facts.push("memory");
  if (display.showUsage && display.externalUsagePath) facts.push("usage.read");
  if (display.externalUsageWritePath && stdinUsage) facts.push("usage.target");

  const readTranscript = async (): Promise<TranscriptData> => {
    const data = await parseTranscript(paths.transcript ?? "", dataDir);
    // Only the agents the line will show, since each lookup opens a file.
    if (display.showAgents && display.showAgentEffort && paths.subagents) await addSubagentEfforts(paths.subagents, shownAgents(data.agents, now));
    return data;
  };
  const [answers, transcript, gitStatus] = await Promise.all([
    ask(facts),
    files && needsTranscript(config, stdin) ? readTranscript() : EMPTY_TRANSCRIPT,
    resolveVcsStatus(config, ask, stdin.cwd, stdin.workspace?.repo),
  ]);

  const usageData = display.showUsage ? resolveUsage(config, stdinUsage, answers["usage.read"], now) : null;
  const lines = renderLines({
    stdin,
    transcript,
    ...(files && display.showConfigCounts ? countConfigs(paths) : NO_COUNTS),
    costTotals: display.showDailyCost || display.showWeeklyCost
      ? getCostTotals(stdin, { allowRoutedCost: display.showRoutedCost, sevenDayResetAt: usageData?.sevenDayResetAt ?? null },
        { dataDir: () => dataDir, now: () => now })
      : null,
    outputSpeed: display.showSpeed ? getOutputSpeed(stdin, dataDir) : null,
    gitStatus,
    usageData,
    memoryUsage: "memory" in answers ? getMemoryUsage(readMemory(answers.memory as MemoryFacts)) : null,
    config,
    extraLabel: extraCmdLabel(answers.extra),
    authInfo: files && (display.showAuth || display.showAuthUser) ? readAuthInfo(paths.claudeJson) : null,
  }, columns, now);
  const snapshot = externalUsageSnapshot(answers["usage.target"] as UsageTarget, stdinUsage, now);
  return snapshot ? { lines, snapshot } : { lines };
}

// A config problem is one line ending in /hud, never a silent fallback. Like every line it fits the
// terminal; when it can't, the problem is cut, never the way to fix it.
const FIX = ". Type /hud to fix it.";
function problemLine(problems: string[], columns: number | null): string[] {
  if (problems.length === 0) return [];
  const more = problems.length > 1 ? ` (and ${problems.length - 1} more)` : "";
  const line = `claude-hud: ${problems[0]}${more}`;
  if (!columns || visibleWidth(line + FIX) <= columns) return [line + FIX];
  return [truncateToWidth(`${truncateToWidth(line, Math.max(1, columns - FIX.length))}${FIX}`, columns)];
}

export async function main(): Promise<void> {
  const input = await open();
  try {
    const loaded = loadConfigFiles(input.paths);
    setLanguage(loaded.config.language);
    if (input.command) {
      // Loaded only for a subcommand, so a render doesn't pay for it.
      const { runCommand } = await import("./commands.ts");
      finish(await runCommand(input, loaded, renderStdin, ask));
      return;
    }
    const { stdin, paths, now } = input;
    if (!stdin) {
      // Setup runs the command without input to check that it starts.
      finish({ lines: [t("init.initializing"), ...(process.platform === "darwin" ? [t("init.macosNote")] : [])] });
      return;
    }
    const columns = getTerminalWidth();
    const output = await renderStdin(stdin, loaded.config, { ask, files: true, paths, dataDir: paths.data, now, columns });
    finish({ ...output, lines: [...output.lines, ...problemLine(loaded.problems, columns)] });
  } catch (error) {
    finish({ lines: [`[claude-hud] Error: ${error instanceof Error ? error.message : "Unknown error"}. Type /hud to fix it.`], failed: true });
  }
}

await main();
