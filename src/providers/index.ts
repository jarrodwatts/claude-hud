import type { FrameworkProvider, FrameworkStatus } from '../types.js';
import { AgwProvider } from './agw-provider.js';
import { AgentTeamsProvider } from './agent-teams-provider.js';

interface FrameworksConfig {
  agw: { enabled: boolean; endpoint: string };
  agentTeams: { enabled: boolean };
}

export function loadProviders(config: FrameworksConfig, cacheDir: string): FrameworkProvider[] {
  const providers: FrameworkProvider[] = [];
  if (config.agw.enabled) providers.push(new AgwProvider(config.agw.endpoint, cacheDir));
  if (config.agentTeams.enabled) providers.push(new AgentTeamsProvider(cacheDir));
  return providers;
}

export async function fetchAllProviders(providers: FrameworkProvider[]): Promise<FrameworkStatus[]> {
  const results: FrameworkStatus[] = [];
  for (const provider of providers) {
    if (!provider.isAvailable()) continue;
    try {
      const status = await provider.fetch();
      if (status && status.entries.length > 0) results.push(status);
    } catch { /* Silent skip — error boundary */ }
  }
  return results;
}
