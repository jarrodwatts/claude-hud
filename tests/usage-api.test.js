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
        return null;
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
        return buildApiResponse();
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
        return buildApiResponse();
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
        return buildApiResponse();
      },
      now: () => 1000,
      readKeychain: () => null,
    });

    assert.equal(result, null);
    assert.equal(fetchCalls, 0);
  });

  test('falls back to file when keychain credentials are missing subscriptionType', async () => {
    await writeCredentials(tempHome, buildCredentials({ subscriptionType: 'claude_pro_2024' }));
    let fetchCalls = 0;
    const result = await getUsage({
      homeDir: () => tempHome,
      fetchApi: async () => {
        fetchCalls += 1;
        return buildApiResponse();
      },
      now: () => 1000,
      readKeychain: () => ({ accessToken: 'keychain-token', subscriptionType: '' }),
    });

    assert.equal(fetchCalls, 1);
    assert.equal(result?.planName, 'Pro');
  });

  test('parses plan name and usage data', async () => {
    await writeCredentials(tempHome, buildCredentials({ subscriptionType: 'claude_pro_2024' }));
    let fetchCalls = 0;
    const result = await getUsage({
      homeDir: () => tempHome,
      fetchApi: async () => {
        fetchCalls += 1;
        return buildApiResponse();
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
      fetchApi: async () => buildApiResponse(),
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
      return null;
    };

    const first = await getUsage({
      homeDir: () => tempHome,
      fetchApi,
      now: () => nowValue,
      readKeychain: () => null,
    });
    assert.equal(first?.apiUnavailable, true);
    assert.equal(fetchCalls, 1);

    nowValue += 10_000;
    const cached = await getUsage({
      homeDir: () => tempHome,
      fetchApi,
      now: () => nowValue,
      readKeychain: () => null,
    });
    assert.equal(cached?.apiUnavailable, true);
    assert.equal(fetchCalls, 1);

    nowValue += 6_000;
    const second = await getUsage({
      homeDir: () => tempHome,
      fetchApi,
      now: () => nowValue,
      readKeychain: () => null,
    });
    assert.equal(second?.apiUnavailable, true);
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
      return buildApiResponse();
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
      return null;
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
      return buildApiResponse();
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
