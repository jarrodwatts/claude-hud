#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { select, confirm } from '@inquirer/prompts';
import { showStaticPreview, resetPreviewState } from './preview.js';

type LayoutType = 'default' | 'separators';

interface HudConfig {
  layout: LayoutType;
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
    showUsage: boolean;
    showTools: boolean;
    showAgents: boolean;
    showTodos: boolean;
  };
}

const DEFAULT_CONFIG: HudConfig = {
  layout: 'default',
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
    showUsage: true,
    showTools: true,
    showAgents: true,
    showTodos: true,
  },
};

// ANSI color codes
const RESET = '\x1b[0m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const DIM = '\x1b[2m';

function getConfigPath(): string {
  const homeDir = os.homedir();
  return path.join(homeDir, '.claude', 'plugins', 'claude-hud', 'config.json');
}

function isValidLayout(value: unknown): value is LayoutType {
  return value === 'default' || value === 'separators';
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
        layout: isValidLayout(parsed.layout) ? parsed.layout : DEFAULT_CONFIG.layout,
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

function formatLayoutName(layout: LayoutType): string {
  switch (layout) {
    case 'default': return 'Default';
    case 'separators': return 'Separators';
  }
}

// Section editors
async function editLayout(config: HudConfig): Promise<void> {
  console.log(`\n${YELLOW}── Layout ──${RESET}`);
  config.layout = await select({
    message: 'Choose HUD layout',
    choices: [
      { name: 'Default    →  All info on first line', value: 'default' as const },
      { name: 'Separators →  With ─── divider below header', value: 'separators' as const },
    ],
    default: config.layout,
  });
}

async function editPathDisplay(config: HudConfig): Promise<void> {
  console.log(`\n${YELLOW}── Path Display ──${RESET}`);
  config.pathLevels = await select({
    message: 'Directory levels to show',
    choices: [
      { name: '1 level  →  my-project', value: 1 as const },
      { name: '2 levels →  apps/my-project', value: 2 as const },
      { name: '3 levels →  dev/apps/my-project', value: 3 as const },
    ],
    default: config.pathLevels,
  });
}

async function editGitStatus(config: HudConfig): Promise<void> {
  console.log(`\n${YELLOW}── Git Status ──${RESET}`);
  config.gitStatus.enabled = await confirm({
    message: 'Show git branch',
    default: config.gitStatus.enabled,
  });

  if (config.gitStatus.enabled) {
    config.gitStatus.showDirty = await confirm({
      message: 'Show dirty indicator (*)',
      default: config.gitStatus.showDirty,
    });

    config.gitStatus.showAheadBehind = await confirm({
      message: 'Show ahead/behind (↑N ↓N)',
      default: config.gitStatus.showAheadBehind,
    });
  }
}

async function editSessionLine(config: HudConfig): Promise<void> {
  console.log(`\n${YELLOW}── Session Line ──${RESET}`);
  config.display.showModel = await confirm({
    message: 'Show model name [Opus]',
    default: config.display.showModel,
  });

  config.display.showContextBar = await confirm({
    message: 'Show context bar ████░░░░░░',
    default: config.display.showContextBar,
  });

  config.display.showConfigCounts = await confirm({
    message: 'Show config counts (CLAUDE.md, rules, MCPs, hooks)',
    default: config.display.showConfigCounts,
  });

  config.display.showDuration = await confirm({
    message: 'Show session duration ⏱️',
    default: config.display.showDuration,
  });

  config.display.showTokenBreakdown = await confirm({
    message: 'Show token breakdown at high context',
    default: config.display.showTokenBreakdown,
  });
}

async function editAdditionalLines(config: HudConfig): Promise<void> {
  console.log(`\n${YELLOW}── Additional Lines ──${RESET}`);
  config.display.showTools = await confirm({
    message: 'Show tools line',
    default: config.display.showTools,
  });

  config.display.showAgents = await confirm({
    message: 'Show agents line',
    default: config.display.showAgents,
  });

  config.display.showTodos = await confirm({
    message: 'Show todos line',
    default: config.display.showTodos,
  });
}

type MenuAction = 'layout' | 'path' | 'git' | 'session' | 'lines' | 'save' | 'exit';

async function showMainMenu(config: HudConfig): Promise<MenuAction> {
  // Show current preview
  showStaticPreview(config);

  // Build menu with current values shown
  const gitSummary = config.gitStatus.enabled
    ? `on${config.gitStatus.showDirty ? ', dirty' : ''}${config.gitStatus.showAheadBehind ? ', ahead/behind' : ''}`
    : 'off';

  const sessionCount = [
    config.display.showModel,
    config.display.showContextBar,
    config.display.showConfigCounts,
    config.display.showDuration,
    config.display.showTokenBreakdown,
  ].filter(Boolean).length;

  const linesCount = [
    config.display.showTools,
    config.display.showAgents,
    config.display.showTodos,
  ].filter(Boolean).length;

  console.log(`\n${CYAN}─── Main Menu ───${RESET}`);

  return select({
    message: 'What would you like to configure?',
    choices: [
      { name: `Layout          ${DIM}(${formatLayoutName(config.layout)})${RESET}`, value: 'layout' as const },
      { name: `Path Display    ${DIM}(${config.pathLevels} level${config.pathLevels > 1 ? 's' : ''})${RESET}`, value: 'path' as const },
      { name: `Git Status      ${DIM}(${gitSummary})${RESET}`, value: 'git' as const },
      { name: `Session Line    ${DIM}(${sessionCount}/5 options)${RESET}`, value: 'session' as const },
      { name: `Additional Lines ${DIM}(${linesCount}/3 lines)${RESET}`, value: 'lines' as const },
      { name: `${GREEN}✓ Save & Exit${RESET}`, value: 'save' as const },
      { name: `${DIM}✗ Exit without saving${RESET}`, value: 'exit' as const },
    ],
  });
}

async function main(): Promise<void> {
  console.log(`\n${CYAN}=== Claude HUD Configuration ===${RESET}\n`);

  resetPreviewState();

  const configPath = getConfigPath();
  const configExists = fs.existsSync(configPath);

  if (configExists) {
    console.log(`${GREEN}✓ Existing configuration found${RESET}`);
  }

  // Load config (mutable copy)
  const config = loadExistingConfig();

  // Main menu loop
  let running = true;
  while (running) {
    const action = await showMainMenu(config);

    switch (action) {
      case 'layout':
        await editLayout(config);
        break;
      case 'path':
        await editPathDisplay(config);
        break;
      case 'git':
        await editGitStatus(config);
        break;
      case 'session':
        await editSessionLine(config);
        break;
      case 'lines':
        await editAdditionalLines(config);
        break;
      case 'save':
        saveConfig(config);
        console.log(`\n${GREEN}✓ Configuration saved to:${RESET} ${configPath}`);
        running = false;
        break;
      case 'exit':
        console.log(`\n${YELLOW}✗ Configuration not saved.${RESET}`);
        running = false;
        break;
    }
  }
}

main().catch(console.error);
