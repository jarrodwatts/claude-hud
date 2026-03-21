import fs from 'node:fs';
import { getConfigPath, loadConfig } from './config.js';
import { getDefaultCacheDir } from './cache.js';

export interface HealthStatus {
  configExists: boolean;
  configValid: boolean;
  cacheDir: string;
  cacheDirExists: boolean;
  nodeVersion: string;
  platform: string;
  terminalWidth: number | null;
}

export async function runHealthCheck(): Promise<HealthStatus> {
  const configPath = getConfigPath();
  let configValid = false;
  const configExists = fs.existsSync(configPath);

  if (configExists) {
    try {
      await loadConfig();
      configValid = true;
    } catch {
      configValid = false;
    }
  }

  const cacheDir = getDefaultCacheDir();

  return {
    configExists,
    configValid,
    cacheDir,
    cacheDirExists: fs.existsSync(cacheDir),
    nodeVersion: process.version,
    platform: process.platform,
    terminalWidth: process.stdout?.columns ?? null,
  };
}

export function formatHealthReport(status: HealthStatus): string {
  const lines = [
    `Platform: ${status.platform} | Node: ${status.nodeVersion}`,
    `Terminal: ${status.terminalWidth ?? 'unknown'} cols`,
    `Config: ${status.configExists ? (status.configValid ? '✓ valid' : '✘ invalid') : '○ not set (using defaults)'}`,
    `Cache: ${status.cacheDirExists ? '✓ exists' : '○ will be created'}`,
  ];
  return lines.join('\n');
}
