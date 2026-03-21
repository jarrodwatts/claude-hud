import type { RenderContext } from './types.js';

export interface Suggestion {
  icon: string;
  message: string;
  priority: number; // lower = more important
}

export function getSuggestions(ctx: RenderContext): Suggestion[] {
  const suggestions: Suggestion[] = [];

  // High context usage
  const contextPercent = getContextPercentFromCtx(ctx);
  if (contextPercent >= 90) {
    suggestions.push({
      icon: '💡',
      message: 'Consider committing and starting a new session',
      priority: 1,
    });
  } else if (contextPercent >= 80) {
    suggestions.push({
      icon: '💡',
      message: 'Context filling up — wrap up current task soon',
      priority: 2,
    });
  }

  // High burn rate
  if (ctx.burnRate && ctx.burnRate.tokensPerMinute > 5000) {
    suggestions.push({
      icon: '⚡',
      message: 'High token burn — consider using haiku for subtasks',
      priority: 3,
    });
  }

  // Many autocompacts
  if (ctx.sessionStats && ctx.sessionStats.autocompactCount >= 3) {
    suggestions.push({
      icon: '🔄',
      message: `${ctx.sessionStats.autocompactCount} autocompacts — split into smaller sessions`,
      priority: 2,
    });
  }

  // Many tool errors
  const errorCount = ctx.transcript.tools.filter(t => t.status === 'error').length;
  const totalTools = ctx.transcript.tools.length;
  if (totalTools > 5 && errorCount / totalTools > 0.3) {
    suggestions.push({
      icon: '⚠',
      message: `High error rate (${errorCount}/${totalTools}) — check approach`,
      priority: 1,
    });
  }

  return suggestions.sort((a, b) => a.priority - b.priority).slice(0, 1); // Only top suggestion
}

function getContextPercentFromCtx(ctx: RenderContext): number {
  const usage = ctx.stdin.context_window?.current_usage;
  const size = ctx.stdin.context_window?.context_window_size;
  if (!usage || !size || size === 0) return 0;
  const total = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
  return Math.round((total / size) * 100);
}
