import type { StdinData } from './types.js';
import { isBedrockModelId, isVertexModelId } from './stdin.js';

// Claude Code's own session cost. Bedrock and Vertex bill through the cloud provider,
// so their list-price figure is shown only with display.showRoutedCost, and only once
// it is positive (it reads $0.00 until the first response).
export function getNativeCostUsd(stdin: StdinData, options?: { allowRoutedCost?: boolean }): number | null {
  const cost = stdin.cost?.total_cost_usd;
  if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0) {
    return null;
  }
  const routed = isBedrockModelId(stdin.model?.id) || isVertexModelId(stdin.model?.id);
  if (routed && (!options?.allowRoutedCost || cost === 0)) {
    return null;
  }
  return cost;
}

export function formatUsd(amount: number): string {
  if (amount >= 1) return `$${amount.toFixed(2)}`;
  if (amount >= 0.1) return `$${amount.toFixed(3)}`;
  return `$${amount.toFixed(4)}`;
}
