import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getUsage,
  clearCache,
  getKeychainServiceName,
  getKeychainServiceNames,
  resolveKeychainCredentials,
  getUsageApiTimeoutMs,
  isNoProxy,
  getProxyUrl,
} from '../dist/usage-api.js';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';

let tempHome = null;

async function createTempHome() {
  return await mkdtemp(path.join(tmpdir(), 'claude-hud-usage-'));
}

function restoreEnvVar(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

async function writeCredentialsInConfigDir(configDir, credentials) {
  const credDir = configDir;
  await mkdir(credDir, { recursive: true });
  await writeFile(path.join(credDir, '.credentials.json'), JSON.stringify(credentials), 'utf8');
}

async function writeCredentials(homeDir, credentials) {
  await writeCredentialsInConfigDir(path.join(homeDir, '.claude'), credentials);
}

function buildCredentials(overrides = {}) {
  return {
    claudeAiOauth: {
      accessToken: 'test-token',
      subscriptionType: 'claude_pro_2024',
      expiresAt: Date.now() + 3600000, // 1 hour from now
      ...overrides,
    },
  };
}

function buildApiResponse(overrides = {}) {
  return {
    five_hour: {
      utilization: 25,
      resets_at: '2026-01-06T15:00:00Z',
    },
    seven_day: {
      utilization: 10,
      resets_at: '2026-01-13T00:00:00Z',
    },
    ...overrides,
  };
}

function buildApiResult(overrides = {}) {
  return {
    data: buildApiResponse(),
    ...overrides,
  };
}

function buildMissingKeychainError() {
  const err = new Error('security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.');
  err.status = 44;
  return err;
}

describe('resolveKeychainCredentials', () => {
  test('falls back to legacy service when profile-specific service is missing', () => {
    const now = 1000;
    const serviceNames = ['Claude Code-credentials-deadbeef', 'Claude Code-credentials'];
    const calls = [];

    const result = resolveKeychainCredentials(serviceNames, now, (serviceName) => {
      calls.push(serviceName);
      if (serviceName === 'Claude Code-credentials-deadbeef') {
        throw buildMissingKeychainError();
      }
      return JSON.stringify(buildCredentials({
        accessToken: 'legacy-token',
        subscriptionType: 'claude_pro_2024',
        expiresAt: now + 60_000,
      }));
    });

    assert.equal(result.credentials?.accessToken, 'legacy-token');
    assert.equal(result.shouldBackoff, false);
    assert.deepEqual(calls, serviceNames);
  });

  test('does not request backoff when all services are missing', () => {
    const now = 1000;
    const serviceNames = ['Claude Code-credentials-deadbeef', 'Claude Code-credentials'];

    const result = resolveKeychainCredentials(serviceNames, now, () => {
      throw buildMissingKeychainError();
    });

    assert.equal(result.credentials, null);
    assert.equal(result.shouldBackoff, false);
  });

  test('requests backoff on non-missing keychain errors', () => {
    const now = 1000;
    const serviceNames = ['Claude Code-credentials-deadbeef', 'Claude Code-credentials'];

    const result = resolveKeychainCredentials(serviceNames, now, (serviceName) => {
      if (serviceName === 'Claude Code-credentials-deadbeef') {
        throw new Error('security command timed out');
      }
      throw buildMissingKeychainError();
    });

    assert.equal(result.credentials, null);
    assert.equal(result.shouldBackoff, true);
  });

  test('treats missing-item message as non-backoff condition', () => {
    const now = 1000;
    const serviceNames = ['Claude Code-credentials-hashed'];

    const result = resolveKeychainCredentials(serviceNames, now, () => {
      throw new Error('The specified item could not be found in the keychain.');
    });

    assert.equal(result.credentials, null);
    assert.equal(result.shouldBackoff, false);
  });

  test('uses first valid credential in candidate order', () => {
    const now = 1000;
    const serviceNames = ['Claude Code-credentials-canonical', 'Claude Code-credentials-fallback'];

    const result = resolveKeychainCredentials(serviceNames, now, (serviceName) => {
      if (serviceName === 'Claude Code-credentials-canonical') {
        return JSON.stringify(buildCredentials({
          accessToken: 'canonical-token',
          subscriptionType: 'claude_max_2024',
          expiresAt: now + 60_000,
        }));
      }

      return JSON.stringify(buildCredentials({
        accessToken: 'fallback-token',
        subscriptionType: 'claude_pro_2024',
        expiresAt: now + 60_000,
      }));
    });

    assert.equal(result.credentials?.accessToken, 'canonical-token');
    assert.equal(result.shouldBackoff, false);
  });
});

describe('getUsage', () => {
  beforeEach(async () => {
    tempHome = await createTempHome();
    clearCache(tempHome);
  });

  afterEach(async () => {
    if (tempHome) {
      await rm(tempHome, { recursive: true, force: true });
      tempHome = null;
    }
  });

  test('returns null when credentials file does not exist', async () => {
    let fetchCalls = 0;
    const result = await getUsage({
      homeDir: () => tempHome,
      fetchApi: async () => {
        fetchCalls += 1;
        return { data: null };
      },
      now: () => 1000,
      readKeychain: () => null, // Disable Keychain for tests
    });

    assert.equal(result, null);
    assert.equal(fetchCalls, 0);
  });

  test('returns null when claudeAiOauth is missing', async () => {
    await writeCredentials(tempHome, {});
    let fetchCalls = 0;
    const result = await getUsage({
      homeDir: () => tempHome,
      fetchApi: async () => {
        fetchCalls += 1;
        return buildApiResult();
      },
      now: () => 1000,
      readKeychain: () => null,
    });

    assert.equal(result, null);
    assert.equal(fetchCalls, 0);
  });

  test('returns null when token is expired', async () => {
    await writeCredentials(tempHome, buildCredentials({ expiresAt: 500 }));
    let fetchCalls = 0;
    const result = await getUsage({
      homeDir: () => tempHome,
      fetchApi: async () => {
        fetchCalls += 1;
        return buildApiResult();
      },
      now: () => 1000,
      readKeychain: () => null,
    });

    assert.equal(result, null);
    assert.equal(fetchCalls, 0);
  });

  test('returns null for API users (no subscriptionType)', async () => {
    await writeCredentials(tempHome, buildCredentials({ subscriptionType: 'api' }));
    let fetchCalls = 0;
    const result = await getUsage({
      homeDir: () => tempHome,
      fetchApi: async () => {
        fetchCalls += 1;
        return buildApiResult();
      },
      now: () => 1000,
      readKeychain: () => null,
    });

    assert.equal(result, null);
    assert.equal(fetchCalls, 0);
  });

  test('uses complete keychain credentials without falling back to file', async () => {
    // No file credentials - keychain should be sufficient
    let usedToken = null;
    const result = await getUsage({
      homeDir: () => tempHome,
      fetchApi: async (token) => {
        usedToken = token;
        return buildApiResult();
      },
      now: () => 1000,
      readKeychain: () => ({ accessToken: 'keychain-token', subscriptionType: 'claude_max_2024' }),
    });

    assert.equal(usedToken, 'keychain-token');
    assert.equal(result?.planName, 'Max');
  });

  test('uses keychain token with file subscriptionType when keychain lacks subscriptionType', async () => {
    await writeCredentials(tempHome, buildCredentials({
      accessToken: 'old-file-token',
      subscriptionType: 'claude_pro_2024',
    }));
    let usedToken = null;
    const result = await getUsage({
      homeDir: () => tempHome,
      fetchApi: async (token) => {
        usedToken = token;
        return buildApiResult();
      },
      now: () => 1000,
      readKeychain: () => ({ accessToken: 'keychain-token', subscriptionType: '' }),
    });

    // Must use keychain token (authoritative), but can use file's subscriptionType
    assert.equal(usedToken, 'keychain-token', 'should use keychain token, not file token');
    assert.equal(result?.planName, 'Pro');
  });

  test('uses file subscriptionType fallback even when file token is expired', async () => {
    await writeCredentials(tempHome, buildCredentials({
      accessToken: 'stale-file-token',
      subscriptionType: 'claude_team_2024',
      expiresAt: 1,
    }));

    let usedToken = null;
    const result = await getUsage({
      homeDir: () => tempHome,
      fetchApi: async (token) => {
        usedToken = token;
        return buildApiResult();
      },
      now: () => 1000,
      readKeychain: () => ({ accessToken: 'fresh-keychain-token', subscriptionType: '' }),
    });

    assert.equal(usedToken, 'fresh-keychain-token');
    assert.equal(result?.planName, 'Team');
  });

  test('returns null when keychain has token but no subscriptionType anywhere', async () => {
    // No file credentials, keychain has no subscriptionType
    // This user is treated as an API user (no usage limits)
    let fetchCalls = 0;
    const result = await getUsage({
      homeDir: () => tempHome,
      fetchApi: async () => {
        fetchCalls += 1;
        return buildApiResult();
      },
      now: () => 1000,
      readKeychain: () => ({ accessToken: 'keychain-token', subscriptionType: '' }),
    });

    // No subscriptionType means API user, returns null without calling API
    assert.equal(result, null);
    assert.equal(fetchCalls, 0);
  });

  test('parses plan name and usage data', async () => {
    await writeCredentials(tempHome, buildCredentials({ subscriptionType: 'claude_pro_2024' }));
    let fetchCalls = 0;
    const result = await getUsage({
      homeDir: () => tempHome,
      fetchApi: async () => {
        fetchCalls += 1;
        return buildApiResult();
      },
      now: () => 1000,
      readKeychain: () => null,
    });

    assert.equal(fetchCalls, 1);
    assert.equal(result?.planName, 'Pro');
    assert.equal(result?.fiveHour, 25);
    assert.equal(result?.sevenDay, 10);
  });

  test('parses Team plan name', async () => {
    await writeCredentials(tempHome, buildCredentials({ subscriptionType: 'claude_team_2024' }));
    const result = await getUsage({
      homeDir: () => tempHome,
      fetchApi: async () => buildApiResult(),
      now: () => 1000,
      readKeychain: () => null,
    });

    assert.equal(result?.planName, 'Team');
  });

  test('returns apiUnavailable and caches failures', async () => {
    await writeCredentials(tempHome, buildCredentials());
    let fetchCalls = 0;
    let nowValue = 1000;
    const fetchApi = async () => {
      fetchCalls += 1;
      return { data: null, error: 'http-401' };
    };

    const first = await getUsage({
      homeDir: () => tempHome,
      fetchApi,
      now: () => nowValue,
      readKeychain: () => null,
    });
    assert.equal(first?.apiUnavailable, true);
    assert.equal(first?.apiError, 'http-401');
    assert.equal(fetchCalls, 1);

    nowValue += 10_000;
    const cached = await getUsage({
      homeDir: () => tempHome,
      fetchApi,
      now: () => nowValue,
      readKeychain: () => null,
    });
    assert.equal(cached?.apiUnavailable, true);
    assert.equal(cached?.apiError, 'http-401');
    assert.equal(fetchCalls, 1);

    nowValue += 6_000;
    const second = await getUsage({
      homeDir: () => tempHome,
      fetchApi,
      now: () => nowValue,
      readKeychain: () => null,
    });
    assert.equal(second?.apiUnavailable, true);
    assert.equal(second?.apiError, 'http-401');
    assert.equal(fetchCalls, 2);
  });

  test('reads credentials from CLAUDE_CONFIG_DIR and prefers them over default path', async () => {
    const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
    const customConfigDir = path.join(tempHome, '.claude-2');
    process.env.CLAUDE_CONFIG_DIR = customConfigDir;

    try {
      await writeCredentials(tempHome, buildCredentials({ accessToken: 'default-token' }));
      await writeCredentialsInConfigDir(
        customConfigDir,
        buildCredentials({ accessToken: 'custom-token', subscriptionType: 'claude_pro_2024' })
      );

      let usedToken = null;
      const result = await getUsage({
        homeDir: () => tempHome,
        fetchApi: async (token) => {
          usedToken = token;
          return buildApiResult();
        },
        now: () => 1000,
        readKeychain: () => null,
      });

      assert.equal(usedToken, 'custom-token');
      assert.equal(result?.planName, 'Pro');
    } finally {
      restoreEnvVar('CLAUDE_CONFIG_DIR', originalConfigDir);
    }
  });

  test('writes usage cache under CLAUDE_CONFIG_DIR plugin directory', async () => {
    const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
    const customConfigDir = path.join(tempHome, '.claude-2');
    process.env.CLAUDE_CONFIG_DIR = customConfigDir;

    try {
      await writeCredentialsInConfigDir(customConfigDir, buildCredentials({ accessToken: 'custom-token' }));
      const result = await getUsage({
        homeDir: () => tempHome,
        fetchApi: async () => ({ data: null, error: 'http-401' }),
        now: () => 1000,
        readKeychain: () => null,
      });

      assert.equal(result?.apiUnavailable, true);

      const customCachePath = path.join(customConfigDir, 'plugins', 'claude-hud', '.usage-cache.json');
      const defaultCachePath = path.join(tempHome, '.claude', 'plugins', 'claude-hud', '.usage-cache.json');
      assert.equal(existsSync(customCachePath), true);
      assert.equal(existsSync(defaultCachePath), false);
    } finally {
      restoreEnvVar('CLAUDE_CONFIG_DIR', originalConfigDir);
    }
  });
});

describe('getKeychainServiceName', () => {
  test('uses legacy default service name for default config directory', () => {
    const homeDir = '/tmp/claude-hud-home-default';
    const defaultConfigDir = path.join(homeDir, '.claude');
    const serviceName = getKeychainServiceName(defaultConfigDir, homeDir);
    assert.equal(serviceName, 'Claude Code-credentials');
  });

  test('uses profile-specific hashed service name for custom config directory', () => {
    const homeDir = '/tmp/claude-hud-home-custom';
    const customConfigDir = path.join(homeDir, '.claude-2');
    const expectedHash = createHash('sha256').update(path.resolve(customConfigDir)).digest('hex').slice(0, 8);
    const serviceName = getKeychainServiceName(customConfigDir, homeDir);
    assert.equal(serviceName, `Claude Code-credentials-${expectedHash}`);
  });

  test('treats normalized default path as legacy service name', () => {
    const homeDir = '/tmp/claude-hud-home-normalized';
    const serviceName = getKeychainServiceName(path.join(homeDir, '.claude', '..', '.claude'), homeDir);
    assert.equal(serviceName, 'Claude Code-credentials');
  });
});

describe('getKeychainServiceNames', () => {
  test('includes both env-hash and normalized-dir hash candidates before legacy fallback', () => {
    const homeDir = '/tmp/claude-hud-home-candidates';
    const configDir = path.join(homeDir, '.claude-2');
    const envConfigDir = '~/.claude-2';
    const envHash = createHash('sha256').update(envConfigDir).digest('hex').slice(0, 8);
    const normalizedHash = createHash('sha256').update(path.resolve(configDir)).digest('hex').slice(0, 8);

    const serviceNames = getKeychainServiceNames(configDir, homeDir, { CLAUDE_CONFIG_DIR: envConfigDir });

    assert.deepEqual(serviceNames, [
      `Claude Code-credentials-${normalizedHash}`,
      `Claude Code-credentials-${envHash}`,
      'Claude Code-credentials',
    ]);
  });

  test('returns legacy-only when config resolves to default location', () => {
    const homeDir = '/tmp/claude-hud-home-default-candidates';
    const defaultConfigDir = path.join(homeDir, '.claude');

    const serviceNames = getKeychainServiceNames(defaultConfigDir, homeDir, {});

    assert.deepEqual(serviceNames, ['Claude Code-credentials']);
  });

  test('returns legacy-only when env also points to default location', () => {
    const homeDir = '/tmp/claude-hud-home-default-env';
    const defaultConfigDir = path.join(homeDir, '.claude');

    const serviceNames = getKeychainServiceNames(
      defaultConfigDir,
      homeDir,
      { CLAUDE_CONFIG_DIR: defaultConfigDir }
    );

    assert.deepEqual(serviceNames, ['Claude Code-credentials']);
  });
});

describe('getUsage caching behavior', () => {
  beforeEach(async () => {
    tempHome = await createTempHome();
    clearCache(tempHome);
  });

  afterEach(async () => {
    if (tempHome) {
      await rm(tempHome, { recursive: true, force: true });
      tempHome = null;
    }
  });

  test('cache expires after 60 seconds for success', async () => {
    await writeCredentials(tempHome, buildCredentials());
    let fetchCalls = 0;
    let nowValue = 1000;
    const fetchApi = async () => {
      fetchCalls += 1;
      return buildApiResult();
    };

    await getUsage({ homeDir: () => tempHome, fetchApi, now: () => nowValue, readKeychain: () => null });
    assert.equal(fetchCalls, 1);

    nowValue += 30_000;
    await getUsage({ homeDir: () => tempHome, fetchApi, now: () => nowValue, readKeychain: () => null });
    assert.equal(fetchCalls, 1);

    nowValue += 31_000;
    await getUsage({ homeDir: () => tempHome, fetchApi, now: () => nowValue, readKeychain: () => null });
    assert.equal(fetchCalls, 2);
  });

  test('cache expires after 15 seconds for failures', async () => {
    await writeCredentials(tempHome, buildCredentials());
    let fetchCalls = 0;
    let nowValue = 1000;
    const fetchApi = async () => {
      fetchCalls += 1;
      return { data: null, error: 'timeout' };
    };

    await getUsage({ homeDir: () => tempHome, fetchApi, now: () => nowValue, readKeychain: () => null });
    assert.equal(fetchCalls, 1);

    nowValue += 10_000;
    await getUsage({ homeDir: () => tempHome, fetchApi, now: () => nowValue, readKeychain: () => null });
    assert.equal(fetchCalls, 1);

    nowValue += 6_000;
    await getUsage({ homeDir: () => tempHome, fetchApi, now: () => nowValue, readKeychain: () => null });
    assert.equal(fetchCalls, 2);
  });

  test('clearCache removes file-based cache', async () => {
    await writeCredentials(tempHome, buildCredentials());
    let fetchCalls = 0;
    const fetchApi = async () => {
      fetchCalls += 1;
      return buildApiResult();
    };

    await getUsage({ homeDir: () => tempHome, fetchApi, now: () => 1000, readKeychain: () => null });
    assert.equal(fetchCalls, 1);

    clearCache(tempHome);
    await getUsage({ homeDir: () => tempHome, fetchApi, now: () => 2000, readKeychain: () => null });
    assert.equal(fetchCalls, 2);
  });
});

describe('getUsageApiTimeoutMs', () => {
  test('returns default timeout when env is unset', () => {
    assert.equal(getUsageApiTimeoutMs({}), 15000);
  });

  test('returns env timeout when value is a positive integer', () => {
    assert.equal(getUsageApiTimeoutMs({ CLAUDE_HUD_USAGE_TIMEOUT_MS: '20000' }), 20000);
  });

  test('returns default timeout for invalid env values', () => {
    assert.equal(getUsageApiTimeoutMs({ CLAUDE_HUD_USAGE_TIMEOUT_MS: '0' }), 15000);
    assert.equal(getUsageApiTimeoutMs({ CLAUDE_HUD_USAGE_TIMEOUT_MS: '-1' }), 15000);
    assert.equal(getUsageApiTimeoutMs({ CLAUDE_HUD_USAGE_TIMEOUT_MS: 'abc' }), 15000);
  });
});

describe('isNoProxy', () => {
  test('returns false when NO_PROXY is unset', () => {
    assert.equal(isNoProxy('api.anthropic.com', {}), false);
  });

  test('matches exact host and domain suffix patterns', () => {
    assert.equal(isNoProxy('api.anthropic.com', { NO_PROXY: 'api.anthropic.com' }), true);
    assert.equal(isNoProxy('api.anthropic.com', { NO_PROXY: '.anthropic.com' }), true);
    assert.equal(isNoProxy('anthropic.com', { NO_PROXY: '.anthropic.com' }), false);
    assert.equal(isNoProxy('api.anthropic.com', { NO_PROXY: 'anthropic.com' }), true);
  });

  test('supports wildcard and lowercase no_proxy', () => {
    assert.equal(isNoProxy('api.anthropic.com', { NO_PROXY: '*' }), true);
    assert.equal(isNoProxy('api.anthropic.com', { no_proxy: 'api.anthropic.com' }), true);
  });
});

describe('getProxyUrl', () => {
  test('prefers HTTPS_PROXY and falls back through ALL_PROXY then HTTP_PROXY', () => {
    const fromHttps = getProxyUrl('api.anthropic.com', {
      HTTPS_PROXY: 'http://proxy-https.local:8443',
      HTTP_PROXY: 'http://proxy-http.local:8080',
    });
    assert.equal(fromHttps?.hostname, 'proxy-https.local');

    const fromAll = getProxyUrl('api.anthropic.com', {
      ALL_PROXY: 'http://proxy-all.local:8888',
      HTTP_PROXY: 'http://proxy-http.local:8080',
    });
    assert.equal(fromAll?.hostname, 'proxy-all.local');

    const fromHttp = getProxyUrl('api.anthropic.com', {
      HTTP_PROXY: 'http://proxy-http.local:8080',
    });
    assert.equal(fromHttp?.hostname, 'proxy-http.local');
  });

  test('returns null when NO_PROXY matches or proxy URL is invalid', () => {
    assert.equal(getProxyUrl('api.anthropic.com', {
      HTTPS_PROXY: 'http://proxy.local:8080',
      NO_PROXY: 'api.anthropic.com',
    }), null);

    assert.equal(getProxyUrl('api.anthropic.com', {
      HTTPS_PROXY: 'not a url',
    }), null);
  });
});

describe('isLimitReached', () => {
  test('returns true when fiveHour is 100', async () => {
    // Import from types since isLimitReached is exported there
    const { isLimitReached } = await import('../dist/types.js');

    const data = {
      planName: 'Pro',
      fiveHour: 100,
      sevenDay: 50,
      fiveHourResetAt: null,
      sevenDayResetAt: null,
    };

    assert.equal(isLimitReached(data), true);
  });

  test('returns true when sevenDay is 100', async () => {
    const { isLimitReached } = await import('../dist/types.js');

    const data = {
      planName: 'Pro',
      fiveHour: 50,
      sevenDay: 100,
      fiveHourResetAt: null,
      sevenDayResetAt: null,
    };

    assert.equal(isLimitReached(data), true);
  });

  test('returns false when both are below 100', async () => {
    const { isLimitReached } = await import('../dist/types.js');

    const data = {
      planName: 'Pro',
      fiveHour: 50,
      sevenDay: 50,
      fiveHourResetAt: null,
      sevenDayResetAt: null,
    };

    assert.equal(isLimitReached(data), false);
  });

  test('handles null values correctly', async () => {
    const { isLimitReached } = await import('../dist/types.js');

    const data = {
      planName: 'Pro',
      fiveHour: null,
      sevenDay: null,
      fiveHourResetAt: null,
      sevenDayResetAt: null,
    };

    // null !== 100, so should return false
    assert.equal(isLimitReached(data), false);
  });

  test('returns true when sevenDay is 100 but fiveHour is null', async () => {
    const { isLimitReached } = await import('../dist/types.js');

    const data = {
      planName: 'Pro',
      fiveHour: null,
      sevenDay: 100,
      fiveHourResetAt: null,
      sevenDayResetAt: null,
    };

    assert.equal(isLimitReached(data), true);
  });
});
