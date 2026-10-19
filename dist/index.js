import * as os from "node:os";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getUsageFromStdin, isContextUnreported, readStdin } from "./stdin.js";
import { addSubagentEfforts, parseTranscript } from "./transcript.js";
import { render } from "./render/index.js";
import { shownAgents } from "./render/activity.js";
import { countConfigs } from "./config-reader.js";
import { getGitStatus } from "./git.js";
import { getJjStatus, isJjRepo } from "./jj.js";
import { loadConfig } from "./config.js";
import { parseExtraCmdArg, runExtraCmd } from "./extra-cmd.js";
import { getMemoryUsage } from "./memory.js";
import { readAuthInfo } from "./auth.js";
import { getCostTotals } from "./daily-cost.js";
import { getOutputSpeed } from "./speed.js";
import { resolveUsage, writeExternalUsageSnapshot } from "./external-usage.js";
import { setLanguage, t } from "./i18n/index.js";
const EMPTY_TRANSCRIPT = { tools: [], skills: [], mcpServers: [], mcpErrors: [], agents: [], todos: [] };
const NO_COUNTS = { claudeMdCount: 0, rulesCount: 0, mcpCount: 0, hooksCount: 0 };
// CLAUDE_HUD_DISABLE=1 blanks the HUD for one session while keeping the statusLine setting.
export function isHudDisabled(env = process.env) {
    const value = env.CLAUDE_HUD_DISABLE?.trim().toLowerCase();
    return !!value && !["0", "false", "off", "no"].includes(value);
}
function needsTranscript(config, stdin) {
    const d = config.display;
    return d.showTools || d.showSkills || d.showMcp || d.showAgents || d.showTodos
        || d.showConfigCounts || d.showSessionTokens || d.showCompactions || d.showAdvisor
        || d.showSessionStartDate || d.showLastResponseAt || d.showEffortLevel
        || d.modelSource !== "stdin"
        || isContextUnreported(stdin);
}
// jj wins in a repo that has one and opts in; git is the fallback when the jj probe fails.
export async function resolveVcsStatus(config, cwd, repo) {
    if (!cwd)
        return null;
    if (config.jjStatus.enabled && isJjRepo(cwd)) {
        const jjStatus = await getJjStatus(cwd);
        if (jjStatus)
            return jjStatus;
    }
    return config.gitStatus.enabled
        ? getGitStatus(cwd, { lineDiffs: config.gitStatus.showFileStats, repo })
        : null;
}
export async function main() {
    if (isHudDisabled())
        return;
    try {
        const stdin = await readStdin();
        const config = await loadConfig();
        setLanguage(config.language);
        if (!stdin) {
            // Setup runs the command without input to check that it starts.
            console.log(t("init.initializing"));
            if (process.platform === "darwin")
                console.log(t("init.macosNote"));
            return;
        }
        const display = config.display;
        const now = Date.now();
        const extraCmd = parseExtraCmdArg();
        const transcriptPath = stdin.transcript_path ?? "";
        const readTranscript = async () => {
            const data = await parseTranscript(transcriptPath, os.homedir());
            // Only the agents the line will show, since each lookup opens a file.
            if (display.showAgents && display.showAgentEffort)
                await addSubagentEfforts(transcriptPath, shownAgents(data.agents, now));
            return data;
        };
        const [transcript, gitStatus, extraLabel, memoryUsage] = await Promise.all([
            needsTranscript(config, stdin) ? readTranscript() : EMPTY_TRANSCRIPT,
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
    }
    catch (error) {
        console.log("[claude-hud] Error:", error instanceof Error ? error.message : "Unknown error");
    }
}
const isSamePath = (a, b) => {
    try {
        return realpathSync(a) === realpathSync(b);
    }
    catch {
        return a === b;
    }
};
if (process.argv[1] && isSamePath(process.argv[1], fileURLToPath(import.meta.url))) {
    void main();
}
//# sourceMappingURL=index.js.map