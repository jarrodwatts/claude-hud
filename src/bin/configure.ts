#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { select, confirm } from '@inquirer/prompts';
import { showStaticPreview, resetPreviewState } from './preview.js';

type LayoutType = 'default' | 'condensed' | 'separators';

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
    showTools: true,
    showAgents: true,
    showTodos: true,
  },
};

function getConfigPath(): string {
  const homeDir = os.homedir();
  return path.join(homeDir, '.claude', 'plugins', 'claude-hud', 'config.json');
}

function isValidLayout(value: unknown): value is LayoutType {
  return value === 'default' || value === 'condensed' || value === 'separators';
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

async function main(): Promise<void> {
  console.log('\n\x1b[36m=== Claude HUD Configuration ===\x1b[0m\n');

  resetPreviewState();

  const existing = loadExistingConfig();
  const configPath = getConfigPath();
  const configExists = fs.existsSync(configPath);

  if (configExists) {
    console.log('\x1b[32m✓ Existing configuration found\x1b[0m\n');
  }

  // Show initial preview with existing/default config
  showStaticPreview(existing);

  // Layout
  console.log('\n\x1b[33m── Layout ──\x1b[0m');
  const layout = await select({
    message: 'Choose HUD layout',
    choices: [
      { name: 'Default   →  All info on first line', value: 'default' as const },
      { name: 'Condensed →  Model/context top, project bottom', value: 'condensed' as const },
      { name: 'Separators → Condensed with separator lines', value: 'separators' as const },
    ],
    default: existing.layout,
  });

  // Update preview after layout change
  showStaticPreview({ ...existing, layout });

  // Path Levels
  console.log('\n\x1b[33m── Path Display ──\x1b[0m');
  const pathLevels = await select({
    message: 'Directory levels to show',
    choices: [
      { name: '1 level  →  my-project', value: 1 as const },
      { name: '2 levels →  apps/my-project', value: 2 as const },
      { name: '3 levels →  dev/apps/my-project', value: 3 as const },
    ],
    default: existing.pathLevels,
  });

  // Update preview after path levels change
  showStaticPreview({ ...existing, layout, pathLevels });

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

  // Update preview after git status changes
  const currentGitStatus = { enabled: gitEnabled, showDirty, showAheadBehind };
  showStaticPreview({ ...existing, layout, pathLevels, gitStatus: currentGitStatus });

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
    layout,
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

  // Show final preview
  showStaticPreview(config);

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
