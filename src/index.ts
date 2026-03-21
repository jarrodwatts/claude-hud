import { readStdin, getContextPercent } from './stdin.js';
import { parseTranscript } from './transcript.js';
import { render } from './render/index.js';
import { countConfigs } from './config-reader.js';
import { getGitStatus } from './git.js';
import { getUsage } from './usage-api.js';
import { loadConfig } from './config.js';
import { parseExtraCmdArg, runExtraCmd } from './extra-cmd.js';
import type { RenderContext } from './types.js';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { getDefaultCacheDir, readCache, writeCache, readLatency, writeLatency } from './cache.js';
import { loadProviders, fetchAllProviders } from './providers/index.js';
import { evaluateAlerts, shouldBell, sendNotification, recordAlertHistory, runAlertHook } from './alert.js';
import { calculateBurnRate, recordTokenSnapshot } from './burn-rate.js';
import { updateSessionStats, getSessionStats, getSparkline } from './session-stats.js';
import { getTerminalWidth } from './utils/terminal.js';
import { estimateCost } from './cost-tracker.js';
import { saveCurrentSession, getLastSession, formatSessionSummary } from './session-history.js';
import { registerSession, getSessionCount } from './session-lock.js';
import { formatResetTime } from './utils/format.js';
import { getMcpServers } from './mcp-monitor.js';

export type MainDeps = {
  readStdin: typeof readStdin;
  parseTranscript: typeof parseTranscript;
  countConfigs: typeof countConfigs;
  getGitStatus: typeof getGitStatus;
  getUsage: typeof getUsage;
  loadConfig: typeof loadConfig;
  parseExtraCmdArg: typeof parseExtraCmdArg;
  runExtraCmd: typeof runExtraCmd;
  render: typeof render;
  now: () => number;
  log: (...args: unknown[]) => void;
};

export async function main(overrides: Partial<MainDeps> = {}): Promise<void> {
  const deps: MainDeps = {
    readStdin,
    parseTranscript,
    countConfigs,
    getGitStatus,
    getUsage,
    loadConfig,
    parseExtraCmdArg,
    runExtraCmd,
    render,
    now: () => Date.now(),
    log: console.log,
    ...overrides,
  };

  try {
    const stdin = await deps.readStdin();

    if (!stdin) {
      // Running without stdin - this happens during setup verification
      const isMacOS = process.platform === 'darwin';
      deps.log('[claude-hud] Initializing...');
      if (isMacOS) {
        deps.log('[claude-hud] Note: On macOS, you may need to restart Claude Code for the HUD to appear.');
      }
      return;
    }

    registerSession(stdin.cwd);
    const transcriptPath = stdin.transcript_path ?? '';
    const transcript = await deps.parseTranscript(transcriptPath);

    const { claudeMdCount, rulesCount, mcpCount, hooksCount } = await deps.countConfigs(stdin.cwd);

    const config = await deps.loadConfig();
    const gitStatus = config.gitStatus.enabled
      ? await deps.getGitStatus(stdin.cwd)
      : null;

    const cacheDir = getDefaultCacheDir();

    // Only fetch usage if enabled in config (replaces env var requirement)
    const usageStart = Date.now();
    const usageData = config.display.showUsage !== false
      ? await deps.getUsage({
          ttls: {
            cacheTtlMs: config.usage.cacheTtlSeconds * 1000,
            failureCacheTtlMs: config.usage.failureCacheTtlSeconds * 1000,
          },
        })
      : null;
    if (config.display.showUsage !== false && usageData !== null) {
      writeLatency(Date.now() - usageStart, cacheDir);
    }
    const apiLatency = readLatency(cacheDir);

    const extraCmd = deps.parseExtraCmdArg();
    const extraLabel = extraCmd ? await deps.runExtraCmd(extraCmd) : null;

    const sessionDuration = formatSessionDuration(transcript.sessionStart, deps.now);

    // Framework providers
    let frameworkStatus: RenderContext['frameworkStatus'] = [];
    if (config.display.showFrameworks) {
      const providers = loadProviders(config.frameworks, cacheDir);
      frameworkStatus = await fetchAllProviders(providers);
    }

    // Burn rate
    let burnRate: RenderContext['burnRate'] = null;
    const inputTokens = stdin.context_window?.current_usage?.input_tokens;
    const contextSize = stdin.context_window?.context_window_size;
    if (config.display.showBurnRate && inputTokens != null && contextSize != null) {
      recordTokenSnapshot(inputTokens, cacheDir);
      burnRate = calculateBurnRate(inputTokens, contextSize, cacheDir);
    }

    // Context percent
    const contextPercent = getContextPercent(stdin);

    // Session stats
    updateSessionStats(cacheDir, {
      contextPercent,
      toolCount: transcript.tools.length,
      agentCount: transcript.agents.length,
    });
    const sessionStats = getSessionStats(cacheDir);
    const sparkline = getSparkline(cacheDir);

    // Alerts
    let alerts: RenderContext['alerts'] = [];
    if (config.display.showAlerts) {
      alerts = evaluateAlerts({
        contextPercent,
        usage5hPercent: usageData?.fiveHour ?? 0,
        usage7dPercent: usageData?.sevenDay ?? 0,
        estimatedCallsRemaining: burnRate?.estimatedCallsRemaining ?? null,
        usageResetTime: usageData?.fiveHourResetAt
          ? formatResetTime(usageData.fiveHourResetAt)
          : null,
        alertConfig: config.alerts,
        cacheDir,
      });

      if (alerts.length > 0) {
        recordAlertHistory(alerts, cacheDir);
      }

      if (shouldBell(alerts, cacheDir)) {
        process.stderr.write('\x07');
        if (config.display.showNotifications) {
          const criticalAlert = alerts.find(a => a.type.includes('critical'));
          if (criticalAlert) {
            sendNotification('Claude HUD', criticalAlert.message);
          }
        }
      }

      if (config.alerts.hook) {
        for (const alert of alerts.filter(a => a.type.includes('critical'))) {
          runAlertHook(config.alerts.hook as string, alert);
        }
      }
    }

    const costEstimate = config.display.showCost ? estimateCost(stdin, cacheDir) : null;

    const mcpServers = getMcpServers(cacheDir);

    // Session history — only save when stats have changed
    const prevStatsHash = readCache<string>('prev-session-hash', 60000, cacheDir);
    const currentHash = `${sessionStats.totalToolCalls}-${sessionStats.autocompactCount}-${sessionStats.peakContextPercent}`;
    if (prevStatsHash !== currentHash) {
      writeCache('prev-session-hash', currentHash, cacheDir);
      saveCurrentSession({
        startTime: transcript.sessionStart?.toISOString() || new Date().toISOString(),
        duration: sessionDuration,
        model: stdin.model?.display_name || 'unknown',
        peakContextPercent: sessionStats.peakContextPercent,
        autocompactCount: sessionStats.autocompactCount,
        totalToolCalls: sessionStats.totalToolCalls,
        totalAgentRuns: sessionStats.totalAgentRuns,
      });
    }

    // Last session summary — show once at session start
    const shownLastSession = readCache<boolean>('shown-last-session', 24 * 60 * 60 * 1000, cacheDir);
    if (!shownLastSession && transcript.tools.length === 0) {
      const lastSession = getLastSession();
      if (lastSession) {
        console.error(`[claude-hud] ${formatSessionSummary(lastSession)}`);
        writeCache('shown-last-session', true, cacheDir);
      }
    }

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
      config,
      extraLabel,
      frameworkStatus,
      alerts,
      burnRate,
      sessionStats,
      sparkline,
      terminalWidth: getTerminalWidth(),
      costEstimate,
      apiLatency,
      sessionCount: getSessionCount(),
      mcpServers,
    };

    deps.render(ctx);
  } catch (error) {
    deps.log('[claude-hud] Error:', error instanceof Error ? error.message : 'Unknown error');
  }
}

export function formatSessionDuration(sessionStart?: Date, now: () => number = () => Date.now()): string {
  if (!sessionStart) {
    return '';
  }

  const ms = now() - sessionStart.getTime();
  const mins = Math.floor(ms / 60000);

  if (mins < 1) return '<1m';
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
