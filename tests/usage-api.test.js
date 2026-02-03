import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { getUsage, clearCache } from '../dist/usage-api.js';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

let tempHome = null;

async function createTempHome() {
  return await mkdtemp(path.join(tmpdir(), 'claude-hud-usage-'));
}

async function writeCredentials(homeDir, credentials) {
  const credDir = path.join(homeDir, '.claude');
  await mkdir(credDir, { recursive: true });
  await writeFile(path.join(credDir, '.credentials.json'), JSON.stringify(credentials), 'utf8');
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
