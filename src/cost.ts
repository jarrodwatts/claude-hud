import type { SessionTokenUsage, StdinData } from './types.js';
import { isBedrockModelId, isVertexModelId } from './stdin.js';

type ModelPricing = {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  // Undefined keeps the existing cache multipliers. Null means the
  // model does not publish a separately priced cache write.
  cacheReadUsdPerMillion?: number;
  cacheWriteUsdPerMillion?: number | null;
};

export interface SessionCostEstimate {
  totalUsd: number;
  inputUsd: number;
  cacheCreationUsd: number;
  cacheReadUsd: number;
  outputUsd: number;
}

export interface SessionCostDisplay {
  totalUsd: number;
  source: 'native' | 'estimate';
}

const TOKENS_PER_MILLION = 1_000_000;
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;
const SONNET_5_PROMO_END_MS = Date.UTC(2026, 8, 1);
const SONNET_5_PATTERN = /\bsonnet 5(?: \d+)?\b/i;

// Patterns are tried in order; the first match wins. Families with more specific
// model lines (Haiku 4.x differs from Haiku 3.5) must come before any broader
// fallback patterns to avoid silent under-pricing.
const MODEL_PRICING: Array<{ pattern: RegExp; pricing: ModelPricing }> = [
  { pattern: /^minimax m2 7$/i, pricing: { inputUsdPerMillion: 0.3, outputUsdPerMillion: 1.2, cacheReadUsdPerMillion: 0.06, cacheWriteUsdPerMillion: 0.375 } },
  { pattern: /\bopus 5(?: \d+)?\b/i, pricing: { inputUsdPerMillion: 5, outputUsdPerMillion: 25 } },
  { pattern: /\bopus 4 (?:[5-9]|\d{2,})\b/i, pricing: { inputUsdPerMillion: 5, outputUsdPerMillion: 25 } },
  { pattern: /\bopus 4(?: \d+)?\b/i, pricing: { inputUsdPerMillion: 15, outputUsdPerMillion: 75 } },
  { pattern: /\bsonnet 4(?: \d+)?\b/i, pricing: { inputUsdPerMillion: 3, outputUsdPerMillion: 15 } },
  { pattern: /\bsonnet 3 7\b/i, pricing: { inputUsdPerMillion: 3, outputUsdPerMillion: 15 } },
  { pattern: /\bsonnet 3 5\b/i, pricing: { inputUsdPerMillion: 3, outputUsdPerMillion: 15 } },
  { pattern: /\bhaiku 4(?: \d+)?\b/i, pricing: { inputUsdPerMillion: 1, outputUsdPerMillion: 5 } },
  { pattern: /\bhaiku 3 5\b/i, pricing: { inputUsdPerMillion: 0.8, outputUsdPerMillion: 4 } },
  { pattern: /\bfable 5(?: \d+)?\b/i, pricing: { inputUsdPerMillion: 10, outputUsdPerMillion: 50 } },
  // Enterprise plan aliases (e.g. opusplan, sonnetplan, haikuplan)
  { pattern: /\bopusplan\b/i, pricing: { inputUsdPerMillion: 15, outputUsdPerMillion: 75 } },
  { pattern: /\bsonnetplan\b/i, pricing: { inputUsdPerMillion: 3, outputUsdPerMillion: 15 } },
  { pattern: /\bhaikuplan\b/i, pricing: { inputUsdPerMillion: 0.8, outputUsdPerMillion: 4 } },
];

function normalizeModelName(modelName: string): string {
  return modelName
    .toLowerCase()
    .replace(/^claude\s+/, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchModelPricing(modelName: string, now: Date): ModelPricing | null {
  const normalized = normalizeModelName(modelName);
  if (SONNET_5_PATTERN.test(normalized)) {
    return now.getTime() < SONNET_5_PROMO_END_MS
      ? { inputUsdPerMillion: 2, outputUsdPerMillion: 10 }
      : { inputUsdPerMillion: 3, outputUsdPerMillion: 15 };
  }
  for (const entry of MODEL_PRICING) {
    if (entry.pattern.test(normalized)) {
      return entry.pricing;
    }
  }
  return null;
}

function calculateUsd(tokens: number, usdPerMillion: number): number {
  return (tokens * usdPerMillion) / TOKENS_PER_MILLION;
}

function getModelPricing(stdin: StdinData, now: Date): ModelPricing | null {
  const candidates = [
    stdin.model?.display_name?.trim(),
    stdin.model?.id?.trim(),
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const pricing = matchModelPricing(candidate, now);
    if (pricing) {
      return pricing;
    }
  }

  return null;
}

export function estimateSessionCost(
  stdin: StdinData,
  sessionTokens: SessionTokenUsage | undefined,
  options?: { allowRoutedCost?: boolean; now?: Date },
): SessionCostEstimate | null {
  if (!sessionTokens) {
    return null;
  }

  if (!options?.allowRoutedCost && (isBedrockModelId(stdin.model?.id) || isVertexModelId(stdin.model?.id))) {
    return null;
  }

  const pricing = getModelPricing(stdin, options?.now ?? new Date());
  if (!pricing) {
    return null;
  }

  const totalTokens = sessionTokens.inputTokens
    + sessionTokens.cacheCreationTokens
    + sessionTokens.cacheReadTokens
    + sessionTokens.outputTokens;
  if (totalTokens === 0) {
    return null;
  }

  const inputUsd = calculateUsd(sessionTokens.inputTokens, pricing.inputUsdPerMillion);
  const cacheWriteUsdPerMillion = pricing.cacheWriteUsdPerMillion === undefined
    ? pricing.inputUsdPerMillion * CACHE_WRITE_MULTIPLIER
    : pricing.cacheWriteUsdPerMillion ?? 0;
  const cacheReadUsdPerMillion = pricing.cacheReadUsdPerMillion ?? pricing.inputUsdPerMillion * CACHE_READ_MULTIPLIER;
  const cacheCreationUsd = calculateUsd(sessionTokens.cacheCreationTokens, cacheWriteUsdPerMillion);
  const cacheReadUsd = calculateUsd(sessionTokens.cacheReadTokens, cacheReadUsdPerMillion);
  const outputUsd = calculateUsd(sessionTokens.outputTokens, pricing.outputUsdPerMillion);

  return {
    totalUsd: inputUsd + cacheCreationUsd + cacheReadUsd + outputUsd,
    inputUsd,
    cacheCreationUsd,
    cacheReadUsd,
    outputUsd,
  };
}

export function getNativeCostUsd(stdin: StdinData, options?: { allowRoutedCost?: boolean }): number | null {
  const nativeCost = stdin.cost?.total_cost_usd;
  if (typeof nativeCost !== 'number' || !Number.isFinite(nativeCost)) {
    return null;
  }

  if (isBedrockModelId(stdin.model?.id) || isVertexModelId(stdin.model?.id)) {
    // Routed native billing reads $0.00 until the first response; use it only when opted in and positive.
    if (!options?.allowRoutedCost || nativeCost <= 0) {
      return null;
    }
  }

  return nativeCost;
}

export function resolveSessionCost(
  stdin: StdinData,
  sessionTokens: SessionTokenUsage | undefined,
  options?: { allowRoutedCost?: boolean },
): SessionCostDisplay | null {
  const nativeCostUsd = getNativeCostUsd(stdin, options);
  if (nativeCostUsd !== null) {
    return {
      totalUsd: nativeCostUsd,
      source: 'native',
    };
  }

  const estimate = estimateSessionCost(stdin, sessionTokens, options);
  if (!estimate) {
    return null;
  }

  return {
    totalUsd: estimate.totalUsd,
    source: 'estimate',
  };
}

export function formatUsd(amount: number): string {
  if (amount >= 1) {
    return `$${amount.toFixed(2)}`;
  }
  if (amount >= 0.1) {
    return `$${amount.toFixed(3)}`;
  }
  return `$${amount.toFixed(4)}`;
}
