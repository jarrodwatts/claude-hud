import type { RenderContext } from './types.js';
import { getContextPercent } from './stdin.js';
import { isLimitReached } from './types.js';

const CONTEXT_LOW_THRESHOLD = 5;
const CONTEXT_WARNING_THRESHOLD = 70;
const CONTEXT_CRITICAL_THRESHOLD = 85;

function frame(frames: string[], intervalMs: number): string {
  const index = Math.floor(Date.now() / intervalMs) % frames.length;
  return frames[index];
}

export function getKaomoji(ctx: RenderContext): string {
  // Rate limit hit — sad cry
  if (ctx.usageData && isLimitReached(ctx.usageData)) {
    return frame(['(T_T)', '(;_;)', '(T_T)', '(TOT)'], 800);
  }

  const contextPercent = getContextPercent(ctx.stdin);

  // Context critical — fast panic
  if (contextPercent > CONTEXT_CRITICAL_THRESHOLD) {
    return frame(['(；ﾟдﾟ)', '(；°Д°)', '(；ﾟдﾟ)', '(ﾟдﾟ；)'], 400);
  }

  // Tool error — embarrassed
  const hasToolError = ctx.transcript.tools.some(t => t.status === 'error');
  if (hasToolError) {
    return frame(['(*/ω＼*)', '(*/_＼*)', '(*/ω＼*)'], 700);
  }

  // Context warning — worried
  if (contextPercent >= CONTEXT_WARNING_THRESHOLD) {
    return frame(['(´･_･`)', '(´-_-`)', '(´･_･`)'], 700);
  }

  const runningTools = ctx.transcript.tools.filter(t => t.status === 'running');
  const runningAgents = ctx.transcript.agents.filter(a => a.status === 'running');

  // Many tools at once — overwhelmed
  if (runningTools.length > 2) {
    return frame(['(ﾉ°ω°)ﾉ', '(ﾉ°Д°)ﾉ', '(ﾉ>ω<)ﾉ'], 400);
  }

  // Agent delegating — excited/commanding
  if (runningAgents.length > 0) {
    return frame(['(ﾟ∀ﾟ)', '( ﾟ∀ﾟ)', '(ﾟ∀ﾟ )', '(ﾟ∀ﾟ)'], 500);
  }

  // Tools running — focused
  if (runningTools.length > 0) {
    return frame(['(￣ω￣)', '(￣－￣)', '(￣ー￣)', '(￣ω￣)'], 600);
  }

  // All todos done — celebrate
  const todos = ctx.transcript.todos;
  if (todos.length > 0 && todos.every(t => t.status === 'completed')) {
    return frame(['(ﾉ◕ヮ◕)ﾉ*:･ﾟ✧', '✧ﾟ･:(ﾉ◕ヮ◕)ﾉ', '(ﾉ◕ヮ◕)ﾉ*:･ﾟ✧'], 600);
  }

  // Context just cleared — relieved
  if (contextPercent < CONTEXT_LOW_THRESHOLD && contextPercent > 0) {
    return frame(['(￣▽￣)ノ', '( ￣▽￣)ノ', '(￣▽￣)ノ'], 700);
  }

  // Normal — slow happy blink
  return frame(['(◕‿◕)', '(◕‿◕)', '(◕‿◕)', '(-‿-)'], 600);
}
