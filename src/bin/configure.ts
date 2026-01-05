#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { select, confirm } from '@inquirer/prompts';

interface HudConfig {
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

const DEFAULT_CONFIG: HudConfig = {
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

function getConfigPath(): string {
  const homeDir = os.homedir();
  return path.join(homeDir, '.claude', 'plugins', 'claude-hud', 'config.json');
}

function loadExistingConfig(): HudConfig {
  const configPath = getConfigPath();
  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(content);
      return {
        ...DEFAULT_CONFIG,
        ...parsed,
        gitStatus: { ...DEFAULT_CONFIG.gitStatus, ...parsed.gitStatus },
        display: { ...DEFAULT_CONFIG.display, ...parsed.display },
      };
    }
  } catch {
    // Ignore errors, use defaults
  }
  return DEFAULT_CONFIG;
}

function saveConfig(config: HudConfig): void {
  const configPath = getConfigPath();
  const configDir = path.dirname(configPath);

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}

async function main(): Promise<void> {
  console.log('\n\x1b[36m=== Claude HUD Configuration ===\x1b[0m\n');

  const existing = loadExistingConfig();
  const configPath = getConfigPath();
  const configExists = fs.existsSync(configPath);

  if (configExists) {
    console.log('\x1b[32m✓ Existing configuration found\x1b[0m\n');
  }

  // Path Levels
  console.log('\x1b[33m── Path Display ──\x1b[0m');
  const pathLevels = await select({
    message: 'Directory levels to show',
    choices: [
      { name: '1 level  →  my-project', value: 1 as const },
      { name: '2 levels →  apps/my-project', value: 2 as const },
      { name: '3 levels →  dev/apps/my-project', value: 3 as const },
    ],
    default: existing.pathLevels,
  });

  // Git Status
  console.log('\n\x1b[33m── Git Status ──\x1b[0m');
  const gitEnabled = await confirm({
    message: 'Show git branch',
    default: existing.gitStatus.enabled,
  });

  let showDirty = existing.gitStatus.showDirty;
  let showAheadBehind = existing.gitStatus.showAheadBehind;

  if (gitEnabled) {
    showDirty = await confirm({
      message: 'Show dirty indicator (*)',
      default: existing.gitStatus.showDirty,
    });

    showAheadBehind = await confirm({
      message: 'Show ahead/behind (↑N ↓N)',
      default: existing.gitStatus.showAheadBehind,
    });
  }

  // Display Options
  console.log('\n\x1b[33m── Session Line ──\x1b[0m');
  const showModel = await confirm({
    message: 'Show model name [Opus]',
    default: existing.display.showModel,
  });

  const showContextBar = await confirm({
    message: 'Show context bar ████░░░░░░',
    default: existing.display.showContextBar,
  });

  const showConfigCounts = await confirm({
    message: 'Show config counts (CLAUDE.md, rules, MCPs, hooks)',
    default: existing.display.showConfigCounts,
  });

  const showDuration = await confirm({
    message: 'Show session duration ⏱️',
    default: existing.display.showDuration,
  });

  const showTokenBreakdown = await confirm({
    message: 'Show token breakdown at high context',
    default: existing.display.showTokenBreakdown,
  });

  // Additional Lines
  console.log('\n\x1b[33m── Additional Lines ──\x1b[0m');
  const showTools = await confirm({
    message: 'Show tools line',
    default: existing.display.showTools,
  });

  const showAgents = await confirm({
    message: 'Show agents line',
    default: existing.display.showAgents,
  });

  const showTodos = await confirm({
    message: 'Show todos line',
    default: existing.display.showTodos,
  });

  const config: HudConfig = {
    pathLevels,
    gitStatus: {
      enabled: gitEnabled,
      showDirty,
      showAheadBehind,
    },
    display: {
      showModel,
      showContextBar,
      showConfigCounts,
      showDuration,
      showTokenBreakdown,
      showTools,
      showAgents,
      showTodos,
    },
  };

  // Color codes for preview
  const RESET = '\x1b[0m';
  const YELLOW = '\x1b[33m';
  const CYAN = '\x1b[36m';
  const MAGENTA = '\x1b[35m';
  const GREEN = '\x1b[32m';
  const DIM = '\x1b[2m';

  // Show example output with colors
  console.log(`\n${YELLOW}── HUD Preview ──${RESET}`);
  let sessionParts: string[] = [];

  // Path + git
  let pathPart = 'my-project';
  if (pathLevels >= 2) pathPart = 'apps/' + pathPart;
  if (pathLevels >= 3) pathPart = 'dev/' + pathPart;

  let gitPart = '';
  if (gitEnabled) {
    let gitContent = 'main';
    if (showDirty) gitContent += '*';
    if (showAheadBehind) gitContent += ' ↑2';
    gitPart = ` ${MAGENTA}git:(${RESET}${CYAN}${gitContent}${RESET}${MAGENTA})${RESET}`;
  }
  sessionParts.push(`${YELLOW}${pathPart}${RESET}${gitPart}`);

  // Model + context
  const contextBar = `${GREEN}████${RESET}░░░░░░`;
  if (showModel && showContextBar) {
    sessionParts.push(`${CYAN}[Opus]${RESET} ${contextBar} ${GREEN}42%${RESET}`);
  } else if (showModel) {
    sessionParts.push(`${CYAN}[Opus]${RESET} ${GREEN}42%${RESET}`);
  } else if (showContextBar) {
    sessionParts.push(`${contextBar} ${GREEN}42%${RESET}`);
  } else {
    sessionParts.push(`${GREEN}42%${RESET}`);
  }

  if (showConfigCounts) sessionParts.push(`${DIM}2 rules${RESET}`);
  if (showDuration) sessionParts.push(`${DIM}⏱️ 5m${RESET}`);

  console.log(`  ${sessionParts.join(' | ')}`);
  if (showTools) console.log(`  ${CYAN}◐${RESET} Edit: ${DIM}.../file.ts${RESET} | ${GREEN}✓${RESET} Read ×3`);
  if (showAgents) console.log(`  ${GREEN}✓${RESET} explore: Finding auth code ${DIM}(2s)${RESET}`);
  if (showTodos) console.log(`  ${CYAN}▸${RESET} Add tests ${DIM}(1/3)${RESET}`);

  // Show config JSON
  console.log(`\n${YELLOW}── Configuration ──${RESET}`);
  console.log(JSON.stringify(config, null, 2));

  const shouldSave = await confirm({
    message: 'Save this configuration?',
    default: true,
  });

  if (shouldSave) {
    saveConfig(config);
    console.log(`\n\x1b[32m✓ Configuration saved to:\x1b[0m ${configPath}`);
  } else {
    console.log('\n\x1b[33m✗ Configuration not saved.\x1b[0m');
  }
}

main().catch(console.error);
