import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SessionTokenUsage, StdinData } from './types.js';
import type { PricingOverride } from './config.js';
import { isBedrockModelId, isVertexModelId } from './stdin.js';

type ModelPricing = {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
};

type PricingRule = {
  pattern: RegExp;
  pricing: ModelPricing;
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

export interface CostOptions {
  /** User-supplied pricing rules, matched before the bundled defaults. */
  pricingOverrides?: PricingOverride[];
}

const TOKENS_PER_MILLION = 1_000_000;

// Defensive fallback used only if the bundled pricing.json cannot be read
// (e.g. a packaging mishap). Keeps cost estimation working with correct rates.
const FALLBACK_PRICING_DATA: PricingData = {
  cacheWriteMultiplier: 1.25,
  cacheReadMultiplier: 0.1,
  models: [
    { pattern: '\\bopus 4 6\\b', inputUsdPerMillion: 5.5, outputUsdPerMillion: 27.5 },
    { pattern: '\\bopus 4 5\\b', inputUsdPerMillion: 5, outputUsdPerMillion: 25 },
    { pattern: '\\bopus 4(?: \\d+)?\\b', inputUsdPerMillion: 15, outputUsdPerMillion: 75 },
    { pattern: '\\bsonnet 4(?: \\d+)?\\b', inputUsdPerMillion: 3, outputUsdPerMillion: 15 },
    { pattern: '\\bsonnet 3 7\\b', inputUsdPerMillion: 3, outputUsdPerMillion: 15 },
    { pattern: '\\bsonnet 3 5\\b', inputUsdPerMillion: 3, outputUsdPerMillion: 15 },
    { pattern: '\\bhaiku 4 5\\b', inputUsdPerMillion: 1.1, outputUsdPerMillion: 5.5 },
    { pattern: '\\bhaiku 4(?: \\d+)?\\b', inputUsdPerMillion: 1, outputUsdPerMillion: 5 },
    { pattern: '\\bhaiku 3 5\\b', inputUsdPerMillion: 0.8, outputUsdPerMillion: 4 },
    { pattern: '\\bopusplan\\b', inputUsdPerMillion: 15, outputUsdPerMillion: 75 },
    { pattern: '\\bsonnetplan\\b', inputUsdPerMillion: 3, outputUsdPerMillion: 15 },
    { pattern: '\\bhaikuplan\\b', inputUsdPerMillion: 0.8, outputUsdPerMillion: 4 },
  ],
};

interface PricingEntry {
  pattern: string;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
}

interface PricingData {
  cacheWriteMultiplier: number;
  cacheReadMultiplier: number;
  models: PricingEntry[];
}

function isPricingEntry(value: unknown): value is PricingEntry {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return typeof entry.pattern === 'string'
    && typeof entry.inputUsdPerMillion === 'number'
    && Number.isFinite(entry.inputUsdPerMillion)
    && typeof entry.outputUsdPerMillion === 'number'
    && Number.isFinite(entry.outputUsdPerMillion);
}

function loadPricingData(): PricingData {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(path.join(here, 'pricing.json'), 'utf8');
    const parsed = JSON.parse(raw) as Partial<PricingData>;
    const models = Array.isArray(parsed.models) ? parsed.models.filter(isPricingEntry) : [];
    if (models.length === 0) {
      return FALLBACK_PRICING_DATA;
    }
    return {
      cacheWriteMultiplier: typeof parsed.cacheWriteMultiplier === 'number' && Number.isFinite(parsed.cacheWriteMultiplier)
        ? parsed.cacheWriteMultiplier
        : FALLBACK_PRICING_DATA.cacheWriteMultiplier,
      cacheReadMultiplier: typeof parsed.cacheReadMultiplier === 'number' && Number.isFinite(parsed.cacheReadMultiplier)
        ? parsed.cacheReadMultiplier
        : FALLBACK_PRICING_DATA.cacheReadMultiplier,
      models,
    };
  } catch {
    return FALLBACK_PRICING_DATA;
  }
}

function compileRule(entry: PricingEntry): PricingRule | null {
  try {
    return {
      pattern: new RegExp(entry.pattern, 'i'),
      pricing: {
        inputUsdPerMillion: entry.inputUsdPerMillion,
        outputUsdPerMillion: entry.outputUsdPerMillion,
      },
    };
  } catch {
    return null;
  }
}

// Parse and compile the bundled table once per process.
const PRICING_DATA = loadPricingData();
const CACHE_WRITE_MULTIPLIER = PRICING_DATA.cacheWriteMultiplier;
const CACHE_READ_MULTIPLIER = PRICING_DATA.cacheReadMultiplier;
const DEFAULT_PRICING_RULES: PricingRule[] = PRICING_DATA.models
  .map(compileRule)
  .filter((rule): rule is PricingRule => rule !== null);

function normalizeModelName(modelName: string): string {
  return modelName
    .toLowerCase()
    .replace(/^claude\s+/, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchAnthropicPricing(modelName: string, rules: PricingRule[]): ModelPricing | null {
  const normalized = normalizeModelName(modelName);
  for (const rule of rules) {
    if (rule.pattern.test(normalized)) {
      return rule.pricing;
    }
  }
  return null;
}

function buildPricingRules(overrides: PricingOverride[] | undefined): PricingRule[] {
  if (!overrides || overrides.length === 0) {
    return DEFAULT_PRICING_RULES;
  }
  // User overrides are matched first so they take precedence over defaults.
  const compiledOverrides = overrides
    .map(compileRule)
    .filter((rule): rule is PricingRule => rule !== null);
  return [...compiledOverrides, ...DEFAULT_PRICING_RULES];
}

function calculateUsd(tokens: number, usdPerMillion: number): number {
  return (tokens * usdPerMillion) / TOKENS_PER_MILLION;
}

function getAnthropicPricing(stdin: StdinData, rules: PricingRule[]): ModelPricing | null {
  const candidates = [
    stdin.model?.display_name?.trim(),
    stdin.model?.id?.trim(),
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const pricing = matchAnthropicPricing(candidate, rules);
    if (pricing) {
      return pricing;
    }
  }

  return null;
}

export function estimateSessionCost(
  stdin: StdinData,
  sessionTokens: SessionTokenUsage | undefined,
  options: CostOptions = {},
): SessionCostEstimate | null {
  if (!sessionTokens) {
    return null;
  }

  if (isBedrockModelId(stdin.model?.id)) {
    return null;
  }

  if (isVertexModelId(stdin.model?.id)) {
    return null;
  }

  const pricing = getAnthropicPricing(stdin, buildPricingRules(options.pricingOverrides));
  if (!pricing) {
    return null;
  }

  const inputTokens = sessionTokens.inputTokens;

  const totalTokens = inputTokens
    + sessionTokens.cacheCreationTokens
    + sessionTokens.cacheReadTokens
    + sessionTokens.outputTokens;
  if (totalTokens === 0) {
    return null;
  }

  const inputUsd = calculateUsd(inputTokens, pricing.inputUsdPerMillion);
  const cacheCreationUsd = calculateUsd(sessionTokens.cacheCreationTokens, pricing.inputUsdPerMillion * CACHE_WRITE_MULTIPLIER);
  const cacheReadUsd = calculateUsd(sessionTokens.cacheReadTokens, pricing.inputUsdPerMillion * CACHE_READ_MULTIPLIER);
  const outputUsd = calculateUsd(sessionTokens.outputTokens, pricing.outputUsdPerMillion);

  return {
    totalUsd: inputUsd + cacheCreationUsd + cacheReadUsd + outputUsd,
    inputUsd,
    cacheCreationUsd,
    cacheReadUsd,
    outputUsd,
  };
}

function getNativeCostUsd(stdin: StdinData): number | null {
  const nativeCost = stdin.cost?.total_cost_usd;
  if (typeof nativeCost !== 'number' || !Number.isFinite(nativeCost)) {
    return null;
  }

  // Native total is unreliable for cloud billing (AWS/GCP handle it, and the
  // value may be 0 or absent), so never trust it for Bedrock/Vertex.
  if (isBedrockModelId(stdin.model?.id)) {
    return null;
  }

  if (isVertexModelId(stdin.model?.id)) {
    return null;
  }

  return nativeCost;
}

export function resolveSessionCost(
  stdin: StdinData,
  sessionTokens: SessionTokenUsage | undefined,
  options: CostOptions = {},
): SessionCostDisplay | null {
  const nativeCostUsd = getNativeCostUsd(stdin);
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
