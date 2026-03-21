import fs from 'node:fs';
import path from 'node:path';
import { readCache, writeCache } from './cache.js';

const DEBUG = process.env.DEBUG?.includes('claude-hud') || process.env.DEBUG === '*';

export interface McpServerInfo {
  name: string;
  status: 'connected' | 'unknown';
}

export function getMcpServers(cacheDir: string): McpServerInfo[] {
  const cached = readCache<McpServerInfo[]>('mcp-servers', 30000, cacheDir);
  if (cached) return cached;

  const servers: McpServerInfo[] = [];
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(process.env.HOME || '', '.claude');

  try {
    const settingsPath = path.join(configDir, 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      const mcpServers = settings.mcpServers;
      if (mcpServers && typeof mcpServers === 'object') {
        for (const name of Object.keys(mcpServers)) {
          servers.push({ name, status: 'connected' });
        }
      }
    }

    // Also check project-level settings
    const localSettings = ['.claude/settings.json', '.claude/settings.local.json'];
    for (const rel of localSettings) {
      try {
        const content = fs.readFileSync(rel, 'utf-8');
        const local = JSON.parse(content);
        if (local.mcpServers && typeof local.mcpServers === 'object') {
          for (const name of Object.keys(local.mcpServers)) {
            if (!servers.find(s => s.name === name)) {
              servers.push({ name, status: 'connected' });
            }
          }
        }
      } catch {}
    }
  } catch {
    if (DEBUG) console.error('[claude-hud:mcp] error reading MCP config');
  }

  writeCache('mcp-servers', servers, cacheDir);
  return servers;
}
