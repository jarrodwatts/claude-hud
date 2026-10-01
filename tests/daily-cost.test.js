import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  getCostTotals,
  getDailyCostLedgerPath,
  DAILY_COST_WRITE_THROTTLE_MS,
} from '../dist/daily-cost.js';

const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
let homeDir;

function deps(now) {
  return { homeDir: () => homeDir, now: () => now };
}

function localDateKey(now) {
  const date = new Date(now);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}${month}${day}`;
}

function readLedger() {
  return JSON.parse(fs.readFileSync(getDailyCostLedgerPath(homeDir), 'utf8'));
}

// Noon local time, so +/- a few hours never crosses a day boundary.
const todayUsd = (...args) => getCostTotals(...args)?.todayUsd ?? null;
const NOON = new Date(2026, 6, 15, 12, 0, 0).getTime();
const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  delete process.env.CLAUDE_CONFIG_DIR;
  homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-daily-'));
});

afterEach(async () => {
  if (originalConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR;
  } else {
    process.env.CLAUDE_CONFIG_DIR = originalConfigDir;
  }
  await rm(homeDir, { recursive: true, force: true });
});

test('returns null when nothing has been recorded', () => {
  assert.equal(todayUsd({}, undefined, deps(NOON)), null);
  assert.equal(todayUsd({ session_id: 'a' }, undefined, deps(NOON)), null);
  assert.equal(todayUsd({ cost: { total_cost_usd: 1.5 } }, undefined, deps(NOON)), null);
  assert.equal(todayUsd({ session_id: 42, cost: { total_cost_usd: 1.5 } }, undefined, deps(NOON)), null);
});

test('first sighting records a baseline so only increments count', () => {
  const stdin = { session_id: 'a', cost: { total_cost_usd: 2.5 } };
  assert.equal(todayUsd(stdin, undefined, deps(NOON)), 0);

  stdin.cost.total_cost_usd = 4.0;
  assert.equal(todayUsd(stdin, undefined, deps(NOON + 1000)), 1.5);
});

test('total never regresses when stdin reports a lower cost', () => {
  const stdin = { session_id: 'a', cost: { total_cost_usd: 3.0 } };
  todayUsd(stdin, undefined, deps(NOON));
  stdin.cost.total_cost_usd = 5.0;
  assert.equal(todayUsd(stdin, undefined, deps(NOON + 1000)), 2.0);
  stdin.cost.total_cost_usd = 1.0;
  assert.equal(todayUsd(stdin, undefined, deps(NOON + 2000)), 2.0);
});

test('sums increments across sessions', () => {
  todayUsd({ session_id: 'a', cost: { total_cost_usd: 1.0 } }, undefined, deps(NOON));
  todayUsd({ session_id: 'a', cost: { total_cost_usd: 3.0 } }, undefined, deps(NOON + 1000));
  todayUsd({ session_id: 'b', cost: { total_cost_usd: 0.5 } }, undefined, deps(NOON + 2000));
  const total = todayUsd({ session_id: 'b', cost: { total_cost_usd: 1.5 } }, undefined, deps(NOON + 3000));
  assert.equal(total, 3.0);
});

test('day rollover carries active sessions with baseline reset to last total', () => {
  const yesterday = NOON - DAY_MS;
  todayUsd({ session_id: 'a', cost: { total_cost_usd: 1.0 } }, undefined, deps(yesterday));
  todayUsd({ session_id: 'a', cost: { total_cost_usd: 6.0 } }, undefined, deps(yesterday + 1000));

  // First render today: yesterday's $5 increment no longer counts.
  assert.equal(todayUsd({ session_id: 'a', cost: { total_cost_usd: 6.0 } }, undefined, deps(NOON)), 0);
  assert.equal(readLedger().date, localDateKey(NOON));

  // The session keeps accruing today from its carried-over baseline.
  assert.equal(todayUsd({ session_id: 'a', cost: { total_cost_usd: 7.25 } }, undefined, deps(NOON + 1000)), 1.25);
});

test('drops sessions unseen for more than 24 hours', () => {
  const twoDaysAgo = NOON - 2 * DAY_MS;
  todayUsd({ session_id: 'stale', cost: { total_cost_usd: 9.0 } }, undefined, deps(twoDaysAgo));

  assert.equal(todayUsd({ session_id: 'fresh', cost: { total_cost_usd: 0.5 } }, undefined, deps(NOON)), 0);
  assert.deepEqual(Object.keys(readLedger().sessions), ['fresh']);
});

test('recovers from a corrupt ledger file', () => {
  const ledgerPath = getDailyCostLedgerPath(homeDir);
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.writeFileSync(ledgerPath, 'not json{');

  assert.equal(todayUsd({ session_id: 'a', cost: { total_cost_usd: 1.0 } }, undefined, deps(NOON)), 0);
  assert.equal(readLedger().date, localDateKey(NOON));
});

test('ignores malformed session entries in the ledger', () => {
  const ledgerPath = getDailyCostLedgerPath(homeDir);
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.writeFileSync(ledgerPath, JSON.stringify({
    date: localDateKey(NOON),
    sessions: {
      good: { baseline: 1.0, total: 2.5, ts: NOON - 1000 },
      bad: { baseline: 'x', total: -1, ts: null },
    },
  }));

  assert.equal(todayUsd({}, undefined, deps(NOON)), 1.5);
});

test('skips routed providers unless allowRoutedCost is set', () => {
  const stdin = {
    session_id: 'a',
    model: { id: 'us.anthropic.claude-sonnet-4-20250514-v1:0' },
    cost: { total_cost_usd: 2.0 },
  };
  assert.equal(todayUsd(stdin, undefined, deps(NOON)), null);

  assert.equal(todayUsd(stdin, { allowRoutedCost: true }, deps(NOON)), 0);
  stdin.cost.total_cost_usd = 3.5;
  assert.equal(todayUsd(stdin, { allowRoutedCost: true }, deps(NOON + 1000)), 1.5);
});

test('still reports the ledger total when the current payload has no cost', () => {
  todayUsd({ session_id: 'a', cost: { total_cost_usd: 1.0 } }, undefined, deps(NOON));
  todayUsd({ session_id: 'a', cost: { total_cost_usd: 2.0 } }, undefined, deps(NOON + 1000));

  assert.equal(todayUsd({ session_id: 'b' }, undefined, deps(NOON + 2000)), 1.0);
});

test('persists content changes immediately and throttles ts-only refreshes', () => {
  todayUsd({ session_id: 'a', cost: { total_cost_usd: 1.0 } }, undefined, deps(NOON));
  const ledgerPath = getDailyCostLedgerPath(homeDir);
  const firstMtime = fs.statSync(ledgerPath).mtimeMs;

  // Unchanged total within the throttle window: no rewrite.
  todayUsd({ session_id: 'a', cost: { total_cost_usd: 1.0 } }, undefined, deps(NOON + 1000));
  assert.equal(fs.statSync(ledgerPath).mtimeMs, firstMtime);

  // A higher total is a content change: written despite the throttle.
  todayUsd({ session_id: 'a', cost: { total_cost_usd: 2.0 } }, undefined, deps(NOON + 2000));
  assert.equal(readLedger().sessions.a.total, 2.0);

  // Past the throttle window even a ts-only refresh lands.
  todayUsd({ session_id: 'a', cost: { total_cost_usd: 2.0 } }, undefined, deps(NOON + DAILY_COST_WRITE_THROTTLE_MS + 3000));
  assert.equal(readLedger().sessions.a.ts, NOON + DAILY_COST_WRITE_THROTTLE_MS + 3000);
});

test('weekly total spans days and follows the quota window', () => {
  // Window open from NOON - 5 days, so every event below falls inside it.
  const opts = { sevenDayResetAt: new Date(NOON + 2 * DAY_MS) };
  const yesterday = NOON - DAY_MS;

  getCostTotals({ session_id: 'a', cost: { total_cost_usd: 1.0 } }, opts, deps(yesterday));
  getCostTotals({ session_id: 'a', cost: { total_cost_usd: 4.0 } }, opts, deps(yesterday + 1000));

  // Day rollover restarts today's counter but not the week's.
  let totals = getCostTotals({ session_id: 'a', cost: { total_cost_usd: 6.0 } }, opts, deps(NOON));
  assert.equal(totals.todayUsd, 2.0);
  assert.equal(totals.weekUsd, 5.0);

  // Session 'a' ages out of the ledger; its spend stays in the week.
  totals = getCostTotals({ session_id: 'b', cost: { total_cost_usd: 0.5 } }, opts, deps(NOON + DAY_MS + 1000));
  assert.equal(totals.todayUsd, 0);
  assert.equal(totals.weekUsd, 5.0);

  // A new quota window drops the carried spend but counts the increment seen on its first render.
  const next = { sevenDayResetAt: new Date(NOON + 8 * DAY_MS) };
  totals = getCostTotals({ session_id: 'b', cost: { total_cost_usd: 2.5 } }, next, deps(NOON + DAY_MS + 2000));
  assert.equal(totals.weekUsd, 2.0);
  assert.equal(
    getCostTotals({ session_id: 'b', cost: { total_cost_usd: 3.0 } }, next, deps(NOON + DAY_MS + 3000)).weekUsd,
    2.5,
  );
});

test('weekly total stays null until the 7-day reset time is known', () => {
  getCostTotals({ session_id: 'a', cost: { total_cost_usd: 1.0 } }, undefined, deps(NOON));
  const totals = getCostTotals({ session_id: 'a', cost: { total_cost_usd: 3.0 } }, undefined, deps(NOON + 1000));
  assert.equal(totals.todayUsd, 2.0);
  assert.equal(totals.weekUsd, null);

  const withWindow = getCostTotals(
    { session_id: 'a', cost: { total_cost_usd: 3.0 } },
    { sevenDayResetAt: new Date(NOON + 2 * DAY_MS) },
    deps(NOON + 2000),
  );
  assert.equal(withWindow.weekUsd, 2.0);
});
