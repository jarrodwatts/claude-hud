import type { RenderContext } from '../types.js';
import { dim, green, red, yellow, cyan, RESET } from './colors.js';

const DIM = '\x1b[2m';

export function renderBashOutputLine(ctx: RenderContext): string | null {
  const recentBash = ctx.transcript.recentBash;
  if (!recentBash || recentBash.length === 0) return null;

  const display = ctx.config?.display;
  if (display?.showBashOutput === false) return null;

  const maxLines = display?.bashOutputMaxLines ?? 5;
  const cols = process.stdout?.columns || process.stderr?.columns || 80;
  const lines: string[] = [];

  for (const bash of recentBash) {
    const cmd = bash.command;
    const output = bash.output || '';
    const isRunning = bash.endTime === undefined;

    // Status icon
    let icon: string;
    if (isRunning) icon = yellow('◐');
    else if (bash.interrupted) icon = yellow('⊘');
    else if (bash.is_error) icon = red('✗');
    else icon = green('✓');

    // Format time
    const time = bash.time instanceof Date
      ? bash.time.toTimeString().slice(0, 8)
      : '';

    // Truncate command
    const maxCmdLen = cols - 20;
    let cmdDisplay = cmd;
    if (cmdDisplay.length > maxCmdLen) {
      cmdDisplay = cmdDisplay.slice(0, maxCmdLen - 3) + '...';
    }

    const timeTag = time ? dim(`[${time}]`) : '';
    const bgTag = bash.is_background ? ` ${yellow('[bg]')}` : '';
    const runTag = isRunning ? ` ${yellow('running...')}` : '';

    lines.push(`${icon} ${timeTag} ${cyan('$')} ${cmdDisplay}${bgTag}${runTag}`);

    // Show output
    if (output) {
      const allLines = output.trimEnd().split('\n');
      const color = bash.is_error ? '\x1b[31m' : DIM;
      const maxW = cols - 4;

      let showLines: string[];
      if (allLines.length > maxLines) {
        const skipped = allLines.length - maxLines;
        lines.push(`  ${dim(`... ${skipped} lines above ...`)}`);
        showLines = allLines.slice(skipped);
      } else {
        showLines = allLines;
      }

      for (const ol of showLines) {
        const display = ol.length > maxW ? ol.slice(0, maxW - 3) + '...' : ol;
        lines.push(`  ${color}${display}${RESET}`);
      }
    }
  }

  return lines.join('\n');
}
