import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { FrameworkProvider, FrameworkStatus, FrameworkEntry } from '../types.js';
import { readCache, writeCache } from '../cache.js';

const DEBUG = process.env.DEBUG?.includes('claude-hud') || process.env.DEBUG === '*';

const execFileAsync = promisify(execFile);
const CACHE_KEY = 'agent-teams-status';
const SUCCESS_TTL = 5000;

export class AgentTeamsProvider implements FrameworkProvider {
  name = 'agent-teams';
  constructor(private cacheDir: string) {}

  isAvailable(): boolean { return !!process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS; }

  async fetch(): Promise<FrameworkStatus | null> {
    const cached = readCache<FrameworkStatus>(CACHE_KEY, SUCCESS_TTL, this.cacheDir);
    if (cached) return cached;

    try {
      const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], { timeout: 1000 });
      const worktrees = this.parseWorktrees(stdout);
      if (worktrees.length <= 1) return null;

      const entries: FrameworkEntry[] = worktrees.slice(1).map(wt => ({
        label: wt.branch?.replace('refs/heads/', '') || 'detached',
        status: 'running' as const,
        detail: wt.path,
      }));

      const status: FrameworkStatus = { provider: 'Teams', entries };
      writeCache(CACHE_KEY, status, this.cacheDir);
      return status;
    } catch (err) {
      if (DEBUG) console.error('[claude-hud:agent-teams-provider] git worktree error:', err);
      return null;
    }
  }

  private parseWorktrees(output: string): Array<{ path: string; branch?: string }> {
    const worktrees: Array<{ path: string; branch?: string }> = [];
    let current: { path: string; branch?: string } | null = null;
    for (const line of output.split('\n')) {
      if (line.startsWith('worktree ')) {
        if (current) worktrees.push(current);
        current = { path: line.slice(9) };
      } else if (line.startsWith('branch ') && current) {
        current.branch = line.slice(7);
      }
    }
    if (current) worktrees.push(current);
    return worktrees;
  }
}
