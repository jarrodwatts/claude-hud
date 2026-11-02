import { ask, finish, open, type Ask, type Probe } from "./channel.ts";
import { getUsageFromStdin, isContextUnreported } from "./stdin.ts";
import { addSubagentEfforts, parseTranscript } from "./transcript.ts";
import { renderLines } from "./render/index.ts";
import { shownAgents } from "./render/activity.ts";
import { countConfigs, type ConfigCounts } from "./config-reader.ts";
import { getGitStatus, type GitRepoIdentity, type GitStatus } from "./git.ts";
import { getJjStatus } from "./jj.ts";
import { loadConfig, type HudConfig } from "./config.ts";
import { extraCmdLabel } from "./extra-cmd.ts";
import { getMemoryUsage, readMemory, type MemoryFacts } from "./memory.ts";
import { readAuthInfo } from "./auth.ts";
import { getCostTotals } from "./daily-cost.ts";
import { getOutputSpeed } from "./speed.ts";
import { externalUsageSnapshot, resolveUsage, type UsageTarget } from "./external-usage.ts";
import { getTerminalWidth } from "./utils/terminal.ts";
import { setLanguage, t } from "./i18n/index.ts";
import type { StdinData, TranscriptData } from "./types.ts";

// The caged half of a render. hud.mjs starts this under node --permission with fence.mjs loaded,
// hands it the stdin payload, runs the probes it asks for, and prints the lines it returns.

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

async function renderStdin(stdin: StdinData, config: HudConfig, dataDir: string, now: number): Promise<{ lines: string[]; snapshot?: unknown }> {
  const display = config.display;
  const stdinUsage = getUsageFromStdin(stdin);
  const facts: Probe[] = ["extra"];
  if (display.showMemoryUsage && config.lineLayout === "expanded") facts.push("memory");
  if (display.showUsage && display.externalUsagePath) facts.push("usage.read");
  if (display.externalUsageWritePath && stdinUsage) facts.push("usage.target");

  const transcriptPath = stdin.transcript_path ?? "";
  const readTranscript = async (): Promise<TranscriptData> => {
    const data = await parseTranscript(transcriptPath, dataDir);
    // Only the agents the line will show, since each lookup opens a file.
    if (display.showAgents && display.showAgentEffort) await addSubagentEfforts(transcriptPath, shownAgents(data.agents, now));
    return data;
  };
  const [answers, transcript, gitStatus] = await Promise.all([
    ask(facts),
    needsTranscript(config, stdin) ? readTranscript() : EMPTY_TRANSCRIPT,
    resolveVcsStatus(config, ask, stdin.cwd, stdin.workspace?.repo),
  ]);

  const usageData = display.showUsage ? resolveUsage(config, stdinUsage, answers["usage.read"], now) : null;
  const lines = renderLines({
    stdin,
    transcript,
    ...(display.showConfigCounts ? countConfigs(stdin.cwd) : NO_COUNTS),
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
    authInfo: display.showAuth || display.showAuthUser ? readAuthInfo() : null,
  }, getTerminalWidth(), now);
  const snapshot = externalUsageSnapshot(answers["usage.target"] as UsageTarget, stdinUsage, now);
  return snapshot ? { lines, snapshot } : { lines };
}

export async function main(): Promise<void> {
  const { stdin, dataDir, now } = await open();
  try {
    const config = await loadConfig();
    setLanguage(config.language);
    if (!stdin) {
      // Setup runs the command without input to check that it starts.
      finish({ lines: [t("init.initializing"), ...(process.platform === "darwin" ? [t("init.macosNote")] : [])] });
      return;
    }
    finish(await renderStdin(stdin, config, dataDir, now));
  } catch (error) {
    finish({ lines: [`[claude-hud] Error: ${error instanceof Error ? error.message : "Unknown error"}`] });
  }
}

await main();
