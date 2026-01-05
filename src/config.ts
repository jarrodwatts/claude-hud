import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export interface HudConfig {
  pathLevels: 1 | 2 | 3;
  gitStatus: {
    enabled: boolean;
    showDirty: boolean;
    showAheadBehind: boolean;
  };
  display: {
    showModel: boolean;
    showContextBar: boolean;
    showConfigCounts: boolean;
    showDuration: boolean;
    showTokenBreakdown: boolean;
    showTools: boolean;
    showAgents: boolean;
    showTodos: boolean;
  };
}

export const DEFAULT_CONFIG: HudConfig = {
  pathLevels: 1,
  gitStatus: {
    enabled: true,
    showDirty: true,
    showAheadBehind: false,
  },
  display: {
    showModel: true,
    showContextBar: true,
    showConfigCounts: true,
    showDuration: true,
    showTokenBreakdown: true,
    showTools: true,
    showAgents: true,
    showTodos: true,
  },
};

export function getConfigPath(): string {
  const homeDir = os.homedir();
  return path.join(homeDir, '.claude', 'plugins', 'claude-hud', 'config.json');
}

function validatePathLevels(value: unknown): value is 1 | 2 | 3 {
  return value === 1 || value === 2 || value === 3;
}

function mergeConfig(userConfig: Partial<HudConfig>): HudConfig {
  const pathLevels = validatePathLevels(userConfig.pathLevels)
    ? userConfig.pathLevels
    : DEFAULT_CONFIG.pathLevels;

  const gitStatus = {
    enabled: typeof userConfig.gitStatus?.enabled === 'boolean'
      ? userConfig.gitStatus.enabled
      : DEFAULT_CONFIG.gitStatus.enabled,
    showDirty: typeof userConfig.gitStatus?.showDirty === 'boolean'
      ? userConfig.gitStatus.showDirty
      : DEFAULT_CONFIG.gitStatus.showDirty,
    showAheadBehind: typeof userConfig.gitStatus?.showAheadBehind === 'boolean'
      ? userConfig.gitStatus.showAheadBehind
      : DEFAULT_CONFIG.gitStatus.showAheadBehind,
  };

  const display = {
    showModel: typeof userConfig.display?.showModel === 'boolean'
      ? userConfig.display.showModel
      : DEFAULT_CONFIG.display.showModel,
    showContextBar: typeof userConfig.display?.showContextBar === 'boolean'
      ? userConfig.display.showContextBar
      : DEFAULT_CONFIG.display.showContextBar,
    showConfigCounts: typeof userConfig.display?.showConfigCounts === 'boolean'
      ? userConfig.display.showConfigCounts
      : DEFAULT_CONFIG.display.showConfigCounts,
    showDuration: typeof userConfig.display?.showDuration === 'boolean'
      ? userConfig.display.showDuration
      : DEFAULT_CONFIG.display.showDuration,
    showTokenBreakdown: typeof userConfig.display?.showTokenBreakdown === 'boolean'
      ? userConfig.display.showTokenBreakdown
      : DEFAULT_CONFIG.display.showTokenBreakdown,
    showTools: typeof userConfig.display?.showTools === 'boolean'
      ? userConfig.display.showTools
      : DEFAULT_CONFIG.display.showTools,
    showAgents: typeof userConfig.display?.showAgents === 'boolean'
      ? userConfig.display.showAgents
      : DEFAULT_CONFIG.display.showAgents,
    showTodos: typeof userConfig.display?.showTodos === 'boolean'
      ? userConfig.display.showTodos
      : DEFAULT_CONFIG.display.showTodos,
  };

  return { pathLevels, gitStatus, display };
}

export async function loadConfig(): Promise<HudConfig> {
  const configPath = getConfigPath();

  try {
    if (!fs.existsSync(configPath)) {
      return DEFAULT_CONFIG;
    }

    const content = fs.readFileSync(configPath, 'utf-8');
    const userConfig = JSON.parse(content) as Partial<HudConfig>;
    return mergeConfig(userConfig);
  } catch {
    return DEFAULT_CONFIG;
  }
}
