import type { HudConfig } from '../config.js';
import type { RenderContext, ToolEntry, AgentEntry, TodoItem } from '../types.js';
import { render } from '../render/index.js';
import { RESET } from '../render/colors.js';

// ANSI escape sequences for cursor control
const SAVE_CURSOR = '\x1b7';
const RESTORE_CURSOR = '\x1b8';
const CLEAR_TO_END = '\x1b[J';
const MOVE_UP = (n: number) => `\x1b[${n}A`;
const DIM = '\x1b[2m';
const YELLOW = '\x1b[33m';

interface PreviewState {
  lastLineCount: number;
}

const state: PreviewState = {
  lastLineCount: 0,
};

/**
 * Creates a mock RenderContext with sample data for preview
 */
function createMockContext(config: Partial<HudConfig>): RenderContext {
  const fullConfig: HudConfig = {
    layout: config.layout ?? 'default',
    pathLevels: config.pathLevels ?? 1,
    gitStatus: {
      enabled: config.gitStatus?.enabled ?? true,
      showDirty: config.gitStatus?.showDirty ?? true,
      showAheadBehind: config.gitStatus?.showAheadBehind ?? false,
    },
    display: {
      showModel: config.display?.showModel ?? true,
      showContextBar: config.display?.showContextBar ?? true,
      showConfigCounts: config.display?.showConfigCounts ?? true,
      showDuration: config.display?.showDuration ?? true,
      showTokenBreakdown: config.display?.showTokenBreakdown ?? true,
      showTools: config.display?.showTools ?? true,
      showAgents: config.display?.showAgents ?? true,
      showTodos: config.display?.showTodos ?? true,
    },
  };

  // Build mock path based on pathLevels
  let mockPath = '/Users/dev';
  if (fullConfig.pathLevels >= 3) mockPath += '/projects';
  if (fullConfig.pathLevels >= 2) mockPath += '/apps';
  mockPath += '/my-project';

  // Sample tools data
  const tools: ToolEntry[] = fullConfig.display.showTools
    ? [
        {
          id: '1',
          name: 'Edit',
          target: 'src/components/auth.ts',
          status: 'running' as const,
          startTime: new Date(Date.now() - 3000),
        },
        {
          id: '2',
          name: 'Read',
          status: 'completed' as const,
          startTime: new Date(Date.now() - 10000),
          endTime: new Date(Date.now() - 8000),
        },
        {
          id: '3',
          name: 'Read',
          status: 'completed' as const,
          startTime: new Date(Date.now() - 15000),
          endTime: new Date(Date.now() - 12000),
        },
        {
          id: '4',
          name: 'Read',
          status: 'completed' as const,
          startTime: new Date(Date.now() - 20000),
          endTime: new Date(Date.now() - 18000),
        },
      ]
    : [];

  // Sample agent data
  const agents: AgentEntry[] = fullConfig.display.showAgents
    ? [
        {
          id: 'a1',
          type: 'explore',
          model: 'haiku',
          description: 'Finding auth code',
          status: 'completed' as const,
          startTime: new Date(Date.now() - 5000),
          endTime: new Date(Date.now() - 2000),
        },
      ]
    : [];

  // Sample todos data
  const todos: TodoItem[] = fullConfig.display.showTodos
    ? [
        { content: 'Add authentication', status: 'completed' as const },
        { content: 'Write unit tests', status: 'in_progress' as const },
        { content: 'Update documentation', status: 'pending' as const },
      ]
    : [];

  return {
    stdin: {
      cwd: mockPath,
      model: {
        display_name: 'Opus',
      },
      context_window: {
        context_window_size: 200000,
        current_usage: {
          input_tokens: 84000,
          cache_creation_input_tokens: 5000,
          cache_read_input_tokens: 10000,
        },
      },
    },
    transcript: {
      tools,
      agents,
      todos,
      sessionStart: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
    },
    claudeMdCount: 1,
    rulesCount: 2,
    mcpCount: 5,
    hooksCount: 3,
    sessionDuration: '5m',
    gitStatus: fullConfig.gitStatus.enabled
      ? {
          branch: 'main',
          isDirty: fullConfig.gitStatus.showDirty,
          ahead: fullConfig.gitStatus.showAheadBehind ? 2 : 0,
          behind: fullConfig.gitStatus.showAheadBehind ? 1 : 0,
        }
      : null,
    config: fullConfig,
  };
}

/**
 * Captures render output by temporarily replacing console.log
 */
function captureRender(ctx: RenderContext): string[] {
  const lines: string[] = [];
  const originalLog = console.log;

  console.log = (line: string) => {
    lines.push(line);
  };

  try {
    render(ctx);
  } finally {
    console.log = originalLog;
  }

  return lines;
}

/**
 * Generates preview lines for the given config
 */
export function generatePreviewLines(config: Partial<HudConfig>): string[] {
  const ctx = createMockContext(config);
  return captureRender(ctx);
}

/**
 * Renders the preview to the terminal
 */
export function showPreview(config: Partial<HudConfig>, layoutName?: string): void {
  const lines = generatePreviewLines(config);
  const layout = layoutName ?? config.layout ?? 'default';

  // Clear previous preview if exists
  if (state.lastLineCount > 0) {
    process.stdout.write(MOVE_UP(state.lastLineCount));
    process.stdout.write(CLEAR_TO_END);
  }

  // Print header
  console.log(`\n${YELLOW}── Preview (${layout}) ──${RESET}`);

  // Print preview lines with indent
  for (const line of lines) {
    console.log(`  ${line}`);
  }

  console.log(''); // Empty line after preview

  // Track line count for next update (header + lines + empty line)
  state.lastLineCount = 2 + lines.length + 1;
}

/**
 * Clears the preview from the terminal
 */
export function clearPreview(): void {
  if (state.lastLineCount > 0) {
    process.stdout.write(MOVE_UP(state.lastLineCount));
    process.stdout.write(CLEAR_TO_END);
    state.lastLineCount = 0;
  }
}

/**
 * Shows a static preview (doesn't track for updates)
 */
export function showStaticPreview(config: Partial<HudConfig>): void {
  const lines = generatePreviewLines(config);
  const layout = config.layout ?? 'default';

  console.log(`\n${YELLOW}── HUD Preview (${layout}) ──${RESET}`);

  for (const line of lines) {
    console.log(`  ${line}`);
  }
}

/**
 * Resets preview state (call at start of new configuration session)
 */
export function resetPreviewState(): void {
  state.lastLineCount = 0;
}
