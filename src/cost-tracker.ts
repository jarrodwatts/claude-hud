import type { StdinData, BurnRate } from './types.js';

export interface CostEstimate {
  sessionCost: number;     // USD
  inputCostPer1M: number;
  outputCostPer1M: number;
}

// Pricing per 1M tokens (approximate, as of 2026)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'opus': { input: 15, output: 75 },
  'sonnet': { input: 3, output: 15 },
  'haiku': { input: 0.25, output: 1.25 },
};

function getModelTier(modelName: string): string {
  const lower = modelName.toLowerCase();
  if (lower.includes('opus')) return 'opus';
  if (lower.includes('sonnet')) return 'sonnet';
  if (lower.includes('haiku')) return 'haiku';
  return 'sonnet'; // default
}

export function estimateCost(stdin: StdinData, _cacheDir: string): CostEstimate | null {
  const modelName = stdin.model?.display_name || stdin.model?.id || '';
  if (!modelName) return null;

  const usage = stdin.context_window?.current_usage;
  if (!usage) return null;

  const tier = getModelTier(modelName);
  const pricing = MODEL_PRICING[tier];
  if (!pricing) return null;

  const inputTokens = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
  const outputTokens = usage.output_tokens ?? 0;

  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  const sessionCost = inputCost + outputCost;

  return {
    sessionCost,
    inputCostPer1M: pricing.input,
    outputCostPer1M: pricing.output,
  };
}

export function formatCost(cost: number): string {
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(2)}`;
  return `$${cost.toFixed(2)}`;
}

export function predictSessionCost(
  currentCost: number,
  burnRate: BurnRate | null,
  contextWindowSize: number,
  inputTokens: number,
): string | null {
  if (!burnRate || burnRate.tokensPerMinute <= 0) return null;

  const remaining = contextWindowSize - inputTokens;
  if (remaining <= 0) return null;

  const minsLeft = remaining / burnRate.tokensPerMinute;
  // Rough projection: current cost + (cost rate * time remaining)
  const costPerMin = currentCost > 0 && inputTokens > 0
    ? (currentCost / inputTokens) * burnRate.tokensPerMinute
    : 0;

  if (costPerMin <= 0) return null;

  const projectedTotal = currentCost + (costPerMin * minsLeft);
  return formatCost(projectedTotal);
}
