import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('providers', () => {
  describe('agw-provider', () => {
    it('fetch returns null on connection error', async () => {
      const { AgwProvider } = await import('../dist/providers/agw-provider.js');
      const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-agw-'));
      const provider = new AgwProvider('http://localhost:59999', cacheDir);
      const result = await provider.fetch();
      assert.strictEqual(result, null);
      fs.rmSync(cacheDir, { recursive: true, force: true });
    });
  });

  describe('agent-teams-provider', () => {
    it('isAvailable returns false without env var', async () => {
      const origVal = process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS;
      delete process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS;
      const { AgentTeamsProvider } = await import('../dist/providers/agent-teams-provider.js');
      const provider = new AgentTeamsProvider(os.tmpdir());
      assert.strictEqual(provider.isAvailable(), false);
      if (origVal !== undefined) process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = origVal;
    });

    it('isAvailable returns true with env var set', async () => {
      const origVal = process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS;
      process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '1';
      const { AgentTeamsProvider } = await import('../dist/providers/agent-teams-provider.js');
      const provider = new AgentTeamsProvider(os.tmpdir());
      assert.strictEqual(provider.isAvailable(), true);
      if (origVal !== undefined) { process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = origVal; }
      else { delete process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS; }
    });
  });

  describe('provider loader', () => {
    it('loadProviders returns array of providers', async () => {
      const { loadProviders } = await import('../dist/providers/index.js');
      const providers = loadProviders({ agw: { enabled: true, endpoint: 'http://localhost:3000' }, agentTeams: { enabled: true } }, os.tmpdir());
      assert.ok(Array.isArray(providers));
      assert.strictEqual(providers.length, 2);
    });

    it('respects enabled flags', async () => {
      const { loadProviders } = await import('../dist/providers/index.js');
      const providers = loadProviders({ agw: { enabled: false, endpoint: 'http://localhost:3000' }, agentTeams: { enabled: false } }, os.tmpdir());
      assert.strictEqual(providers.length, 0);
    });
  });
});
