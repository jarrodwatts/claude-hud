import * as os from "node:os";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getUsageFromStdin, isContextUnreported, readStdin } from "./stdin.js";
import { parseTranscript } from "./transcript.js";
import { render } from "./render/index.js";
import { countConfigs, type ConfigCounts } from "./config-reader.js";
import { getGitStatus, type GitRepoIdentity, type GitStatus } from "./git.js";
import { getJjStatus, isJjRepo } from "./jj.js";
import { loadConfig, type HudConfig } from "./config.js";
import { parseExtraCmdArg, runExtraCmd } from "./extra-cmd.js";
import { getMemoryUsage } from "./memory.js";
import { readAuthInfo } from "./auth.js";
import { getCostTotals } from "./daily-cost.js";
import { getOutputSpeed } from "./speed.js";
import { resolveUsage, writeExternalUsageSnapshot } from "./external-usage.js";
import { setLanguage, t } from "./i18n/index.js";
import type { StdinData, TranscriptData } from "./types.js";

const EMPTY_TRANSCRIPT: TranscriptData = { tools: [], skills: [], mcpServers: [], mcpErrors: [], agents: [], todos: [] };
const NO_COUNTS: ConfigCounts = { claudeMdCount: 0, rulesCount: 0, mcpCount: 0, hooksCount: 0 };

// CLAUDE_HUD_DISABLE=1 blanks the HUD for one session while keeping the statusLine setting.
export function isHudDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.CLAUDE_HUD_DISABLE?.trim().toLowerCase();
  return !!value && !["0", "false", "off", "no"].includes(value);
}

function needsTranscript(config: HudConfig, stdin: StdinData): boolean {
  const d = config.display;
  return d.showTools || d.showSkills || d.showMcp || d.showAgents || d.showTodos
    || d.showConfigCounts || d.showSessionTokens || d.showCompactions || d.showAdvisor
    || d.showSessionStartDate || d.showLastResponseAt || d.showEffortLevel
    || d.modelSource !== "stdin"
    || isContextUnreported(stdin);
}

// jj wins in a repo that has one and opts in; git is the fallback when the jj probe fails.
export async function resolveVcsStatus(
  config: HudConfig,
  cwd?: string,
  repo?: GitRepoIdentity | null,
): Promise<GitStatus | null> {
  if (!cwd) return null;
  if (config.jjStatus.enabled && isJjRepo(cwd)) {
    const jjStatus = await getJjStatus(cwd);
    if (jjStatus) return jjStatus;
  }
  return config.gitStatus.enabled
    ? getGitStatus(cwd, { lineDiffs: config.gitStatus.showFileStats, repo })
    : null;
}

export async function main(): Promise<void> {
  if (isHudDisabled()) return;

  try {
    const stdin = await readStdin();
    const config = await loadConfig();
    setLanguage(config.language);

    if (!stdin) {
      // Setup runs the command without input to check that it starts.
      console.log(t("init.initializing"));
      if (process.platform === "darwin") console.log(t("init.macosNote"));
      return;
    }

    const display = config.display;
    const now = Date.now();
    const extraCmd = parseExtraCmdArg();
    const [transcript, gitStatus, extraLabel, memoryUsage] = await Promise.all([
      needsTranscript(config, stdin) ? parseTranscript(stdin.transcript_path ?? "") : EMPTY_TRANSCRIPT,
      resolveVcsStatus(config, stdin.cwd, stdin.workspace?.repo),
      extraCmd ? runExtraCmd(extraCmd) : null,
      display.showMemoryUsage && config.lineLayout === "expanded" ? getMemoryUsage() : null,
    ]);

    const stdinUsage = getUsageFromStdin(stdin);
    if (display.externalUsageWritePath && stdinUsage) {
      writeExternalUsageSnapshot(config, stdinUsage, now);
    }
    const usageData = display.showUsage ? resolveUsage(config, stdinUsage, now) : null;

    render({
      stdin,
      transcript,
      ...(display.showConfigCounts ? countConfigs(stdin.cwd) : NO_COUNTS),
      costTotals: display.showDailyCost || display.showWeeklyCost
        ? getCostTotals(stdin, { allowRoutedCost: display.showRoutedCost, sevenDayResetAt: usageData?.sevenDayResetAt ?? null })
        : null,
      outputSpeed: display.showSpeed ? getOutputSpeed(stdin, os.homedir()) : null,
      gitStatus,
      usageData,
      memoryUsage,
      config,
      extraLabel,
      authInfo: display.showAuth || display.showAuthUser ? readAuthInfo() : null,
    });
  } catch (error) {
    console.log("[claude-hud] Error:", error instanceof Error ? error.message : "Unknown error");
  }
}

const isSamePath = (a: string, b: string): boolean => {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return a === b;
  }
};
if (process.argv[1] && isSamePath(process.argv[1], fileURLToPath(import.meta.url))) {
  void main();
}
