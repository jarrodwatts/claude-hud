#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { select, confirm } from '@inquirer/prompts';

interface HudConfig {
  pathLevels: 1 | 2 | 3;
  gitStatus: {
    enabled: boolean;
  };
}

const DEFAULT_CONFIG: HudConfig = {
  pathLevels: 1,
  gitStatus: {
    enabled: true,
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
    console.log('\x1b[32m✓ Existing configuration found\x1b[0m');
    console.log(`  Path levels: ${existing.pathLevels}`);
    console.log(`  Git status: ${existing.gitStatus.enabled ? 'enabled' : 'disabled'}\n`);
  }

  // Path Levels
  const pathLevels = await select({
    message: 'How many directory levels to show?',
    choices: [
      { name: '1 level  →  my-project', value: 1 as const },
      { name: '2 levels →  apps/my-project', value: 2 as const },
      { name: '3 levels →  dev/apps/my-project', value: 3 as const },
    ],
    default: existing.pathLevels,
  });

  // Git Status
  const gitEnabled = await confirm({
    message: 'Show git branch in HUD?',
    default: existing.gitStatus.enabled,
  });

  const config: HudConfig = {
    pathLevels,
    gitStatus: {
      enabled: gitEnabled,
    },
  };

  console.log('\n\x1b[33mPreview:\x1b[0m');
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
