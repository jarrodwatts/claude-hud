import { readStdin, getUsageFromStdin } from "./stdin.js";
import { parseTranscript } from "./transcript.js";
import { render } from "./render/index.js";
import { countConfigs } from "./config-reader.js";
import { getGitStatus } from "./git.js";
import { loadConfig } from "./config.js";
import { parseExtraCmdArg, runExtraCmd } from "./extra-cmd.js";
import { getClaudeCodeVersion } from "./version.js";
import { getMemoryUsage } from "./memory.js";
import { resolveEffortLevel } from "./effort.js";
import { applyContextWindowFallback } from "./context-cache.js";
import { getUsageFromExternalSnapshot, writeExternalUsageSnapshot } from "./external-usage.js";
import { setLanguage, t } from "./i18n/index.js";
import type { RenderContext } from "./types.js";

export { getUsageFromExternalSnapshot, writeExternalUsageSnapshot } from "./external-usage.js";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";

export type MainDeps = {
  readStdin: typeof readStdin;
  getUsageFromStdin: typeof getUsageFromStdin;
  getUsageFromExternalSnapshot: typeof getUsageFromExternalSnapshot;
  writeExternalUsageSnapshot: typeof writeExternalUsageSnapshot;
  parseTranscript: typeof parseTranscript;
  countConfigs: typeof countConfigs;
  getGitStatus: typeof getGitStatus;
  loadConfig: typeof loadConfig;
  parseExtraCmdArg: typeof parseExtraCmdArg;
  runExtraCmd: typeof runExtraCmd;
  getClaudeCodeVersion: typeof getClaudeCodeVersion;
  getMemoryUsage: typeof getMemoryUsage;
  applyContextWindowFallback: typeof applyContextWindowFallback;
  render: typeof render;
  now: () => number;
  log: (...args: unknown[]) => void;
};

/**
 * Returns true when the HUD is disabled for this invocation via the
 * CLAUDE_HUD_DISABLE environment variable. Any non-blank value other than an
 * explicit negative (`0`, `false`, `off`, `no`, case-insensitive) disables the
 * HUD, so users can launch sessions without it (`CLAUDE_HUD_DISABLE=1 claude`)
 * while keeping the statusLine entry in settings.json intact.
 */
export function isHudDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.CLAUDE_HUD_DISABLE?.trim().toLowerCase();
  if (value === undefined || value === "") {
    return false;
  }
  return value !== "0" && value !== "false" && value !== "off" && value !== "no";
}

export async function main(overrides: Partial<MainDeps> = {}): Promise<void> {
  if (isHudDisabled()) {
    // Print nothing so Claude Code renders an empty statusline, and skip all
    // work (stdin parse, transcript scan, git) for the ~300ms polling loop.
    return;
  }

  const deps: MainDeps = {
    readStdin,
    getUsageFromStdin,
    getUsageFromExternalSnapshot,
    writeExternalUsageSnapshot,
    parseTranscript,
    countConfigs,
    getGitStatus,
    loadConfig,
    parseExtraCmdArg,
    runExtraCmd,
    getClaudeCodeVersion,
    getMemoryUsage,
    applyContextWindowFallback,
    render,
    now: () => Date.now(),
    log: console.log,
    ...overrides,
  };

  try {
    const stdin = await deps.readStdin();

    if (!stdin) {
      // Running without stdin - this happens during setup verification
      const config = await deps.loadConfig();
      setLanguage(config.language);
      const isMacOS = process.platform === "darwin";
      deps.log(t("init.initializing"));
      if (isMacOS) {
        deps.log(t("init.macosNote"));
      }
      return;
    }

    const transcriptPath = stdin.transcript_path ?? "";
    const transcript = await deps.parseTranscript(transcriptPath);

    deps.applyContextWindowFallback(stdin, {}, transcript.sessionName, {
      lastCompactBoundaryAt: transcript.lastCompactBoundaryAt,
      lastCompactPostTokens: transcript.lastCompactPostTokens,
    });

    const { claudeMdCount, rulesCount, mcpCount, hooksCount, outputStyle } =
      await deps.countConfigs(stdin.cwd);

    const config = await deps.loadConfig();
    setLanguage(config.language);
    const gitStatus = config.gitStatus.enabled
      ? await deps.getGitStatus(stdin.cwd)
      : null;

    let usageData: RenderContext["usageData"] = null;
    const shouldReadUsage = config.display.showUsage !== false;
    const shouldWriteUsage = Boolean(config.display.externalUsageWritePath);
    const stdinUsage = shouldReadUsage || shouldWriteUsage
      ? deps.getUsageFromStdin(stdin)
      : null;

    if (shouldWriteUsage && stdinUsage) {
      deps.writeExternalUsageSnapshot(config, stdinUsage, deps.now());
    }

    if (shouldReadUsage) {
      usageData = stdinUsage;
      if (!usageData) {
        usageData = deps.getUsageFromExternalSnapshot(config, deps.now());
      } else if (config.display.externalUsagePath) {
        const ext = deps.getUsageFromExternalSnapshot(config, deps.now());
        if (ext != null) {
          usageData = {
            ...usageData,
            ...(ext.balanceLabel != null && { balanceLabel: ext.balanceLabel }),
            // If stdin did not provide sevenDay (e.g. third-party clients like the
            // Claudian Obsidian plugin that only surface five_hour), fall back to the
            // external snapshot so the weekly limit still shows in the HUD.
            ...(usageData.sevenDay == null && ext.sevenDay != null && {
              sevenDay: ext.sevenDay,
              sevenDayResetAt: ext.sevenDayResetAt ?? null,
            }),
          };
        }
      }
    }

    const extraCmd = deps.parseExtraCmdArg();
    const extraLabel = extraCmd ? await deps.runExtraCmd(extraCmd) : null;

    const sessionDuration = formatSessionDuration(
      transcript.sessionStart,
      deps.now,
    );
    const claudeCodeVersion = config.display.showClaudeCodeVersion
      ? await deps.getClaudeCodeVersion()
      : undefined;
    const effortInfo = config.display.showEffortLevel
      ? resolveEffortLevel(stdin.effort)
      : null;
    const memoryUsage =
      config.display.showMemoryUsage && config.lineLayout === "expanded"
        ? await deps.getMemoryUsage()
        : null;

    const ctx: RenderContext = {
      stdin,
      transcript,
      claudeMdCount,
      rulesCount,
      mcpCount,
      hooksCount,
      sessionDuration,
      gitStatus,
      usageData,
      memoryUsage,
      config,
      extraLabel,
      outputStyle,
      claudeCodeVersion,
      effortLevel: effortInfo?.level,
      effortSymbol: effortInfo?.symbol,
    };

    deps.render(ctx);
  } catch (error) {
    deps.log(
      "[claude-hud] Error:",
      error instanceof Error ? error.message : "Unknown error",
    );
  }
}

export function formatSessionDuration(
  sessionStart?: Date,
  now: () => number = () => Date.now(),
): string {
  if (!sessionStart) {
    return "";
  }

  const ms = now() - sessionStart.getTime();
  const mins = Math.floor(ms / 60000);

  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;

  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return `${hours}h ${remainingMins}m`;
}

const scriptPath = fileURLToPath(import.meta.url);
const argvPath = process.argv[1];
const isSamePath = (a: string, b: string): boolean => {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return a === b;
  }
};
if (argvPath && isSamePath(argvPath, scriptPath)) {
  void main();
}
