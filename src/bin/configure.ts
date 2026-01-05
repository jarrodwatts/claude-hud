#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as readline from 'node:readline';

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
      return { ...DEFAULT_CONFIG, ...JSON.parse(content) };
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

async function question(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function confirm(rl: readline.Interface, prompt: string, defaultValue: boolean): Promise<boolean> {
  const defaultHint = defaultValue ? '[Y/n]' : '[y/N]';
  const answer = await question(rl, `${prompt} ${defaultHint}: `);

  if (answer.trim() === '') {
    return defaultValue;
  }

  return answer.toLowerCase().startsWith('y');
}

async function selectNumber(rl: readline.Interface, prompt: string, options: number[], defaultValue: number): Promise<number> {
  const optionsStr = options.map(n => n === defaultValue ? `[${n}]` : n.toString()).join('/');
  const answer = await question(rl, `${prompt} (${optionsStr}): `);

  if (answer.trim() === '') {
    return defaultValue;
  }

  const num = parseInt(answer, 10);
  if (options.includes(num)) {
    return num;
  }

  console.log(`Invalid option. Using default: ${defaultValue}`);
  return defaultValue;
}

async function main(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('\n\x1b[36m=== Claude HUD Configuration ===\x1b[0m\n');
  console.log('Configure your HUD display settings.\n');

  const existing = loadExistingConfig();
  const configPath = getConfigPath();
  const configExists = fs.existsSync(configPath);

  if (configExists) {
    console.log('\x1b[32mExisting configuration found:\x1b[0m');
    console.log(`  Path levels: ${existing.pathLevels}`);
    console.log(`  Git status: ${existing.gitStatus.enabled ? 'enabled' : 'disabled'}`);
    console.log('');
    console.log('Press Enter to keep current values, or enter new ones.\n');
  }

  try {
    // Path Levels
    console.log('\x1b[33m--- Project Path Display ---\x1b[0m');
    console.log('How many directory levels to show in the project path?');
    console.log('  1: my-project');
    console.log('  2: algo/my-project');
    console.log('  3: Users/tsopic/my-project');
    const pathLevels = await selectNumber(rl, 'Path levels', [1, 2, 3], existing.pathLevels) as 1 | 2 | 3;

    console.log('');

    // Git Status
    console.log('\x1b[33m--- Git Status Display ---\x1b[0m');
    const gitEnabled = await confirm(rl, 'Show git branch in HUD?', existing.gitStatus.enabled);

    const config: HudConfig = {
      pathLevels,
      gitStatus: {
        enabled: gitEnabled,
      },
    };

    console.log('\n\x1b[33m--- Preview ---\x1b[0m');
    console.log(JSON.stringify(config, null, 2));

    console.log('');
    const shouldSave = await confirm(rl, 'Save this configuration?', true);

    if (shouldSave) {
      saveConfig(config);
      console.log(`\n\x1b[32mConfiguration saved to:\x1b[0m ${getConfigPath()}`);
    } else {
      console.log('\n\x1b[33mConfiguration not saved.\x1b[0m');
    }

  } finally {
    rl.close();
  }
}

main().catch(console.error);
