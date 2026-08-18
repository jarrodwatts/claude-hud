import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  getDailyCostUsd,
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
  assert.equal(getDailyCostUsd({}, undefined, deps(NOON)), null);
  assert.equal(getDailyCostUsd({ session_id: 'a' }, undefined, deps(NOON)), null);
  assert.equal(getDailyCostUsd({ cost: { total_cost_usd: 1.5 } }, undefined, deps(NOON)), null);
});

test('first sighting records a baseline so only increments count', () => {
  const stdin = { session_id: 'a', cost: { total_cost_usd: 2.5 } };
  assert.equal(getDailyCostUsd(stdin, undefined, deps(NOON)), 0);

  stdin.cost.total_cost_usd = 4.0;
  assert.equal(getDailyCostUsd(stdin, undefined, deps(NOON + 1000)), 1.5);
});

test('total never regresses when stdin reports a lower cost', () => {
  const stdin = { session_id: 'a', cost: { total_cost_usd: 3.0 } };
  getDailyCostUsd(stdin, undefined, deps(NOON));
  stdin.cost.total_cost_usd = 5.0;
  assert.equal(getDailyCostUsd(stdin, undefined, deps(NOON + 1000)), 2.0);
  stdin.cost.total_cost_usd = 1.0;
  assert.equal(getDailyCostUsd(stdin, undefined, deps(NOON + 2000)), 2.0);
});

test('sums increments across sessions', () => {
  getDailyCostUsd({ session_id: 'a', cost: { total_cost_usd: 1.0 } }, undefined, deps(NOON));
  getDailyCostUsd({ session_id: 'a', cost: { total_cost_usd: 3.0 } }, undefined, deps(NOON + 1000));
  getDailyCostUsd({ session_id: 'b', cost: { total_cost_usd: 0.5 } }, undefined, deps(NOON + 2000));
  const total = getDailyCostUsd({ session_id: 'b', cost: { total_cost_usd: 1.5 } }, undefined, deps(NOON + 3000));
  assert.equal(total, 3.0);
});

test('day rollover carries active sessions with baseline reset to last total', () => {
  const yesterday = NOON - DAY_MS;
  getDailyCostUsd({ session_id: 'a', cost: { total_cost_usd: 1.0 } }, undefined, deps(yesterday));
  getDailyCostUsd({ session_id: 'a', cost: { total_cost_usd: 6.0 } }, undefined, deps(yesterday + 1000));

  // First render today: yesterday's $5 increment no longer counts.
  assert.equal(getDailyCostUsd({ session_id: 'a', cost: { total_cost_usd: 6.0 } }, undefined, deps(NOON)), 0);
  assert.equal(readLedger().date, localDateKey(NOON));

  // The session keeps accruing today from its carried-over baseline.
  assert.equal(getDailyCostUsd({ session_id: 'a', cost: { total_cost_usd: 7.25 } }, undefined, deps(NOON + 1000)), 1.25);
});

test('drops sessions unseen for more than 24 hours', () => {
  const twoDaysAgo = NOON - 2 * DAY_MS;
  getDailyCostUsd({ session_id: 'stale', cost: { total_cost_usd: 9.0 } }, undefined, deps(twoDaysAgo));

  assert.equal(getDailyCostUsd({ session_id: 'fresh', cost: { total_cost_usd: 0.5 } }, undefined, deps(NOON)), 0);
  assert.deepEqual(Object.keys(readLedger().sessions), ['fresh']);
});

test('recovers from a corrupt ledger file', () => {
  const ledgerPath = getDailyCostLedgerPath(homeDir);
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.writeFileSync(ledgerPath, 'not json{');

  assert.equal(getDailyCostUsd({ session_id: 'a', cost: { total_cost_usd: 1.0 } }, undefined, deps(NOON)), 0);
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

  assert.equal(getDailyCostUsd({}, undefined, deps(NOON)), 1.5);
});

test('skips routed providers unless allowRoutedCost is set', () => {
  const stdin = {
    session_id: 'a',
    model: { id: 'us.anthropic.claude-sonnet-4-20250514-v1:0' },
    cost: { total_cost_usd: 2.0 },
  };
  assert.equal(getDailyCostUsd(stdin, undefined, deps(NOON)), null);

  assert.equal(getDailyCostUsd(stdin, { allowRoutedCost: true }, deps(NOON)), 0);
  stdin.cost.total_cost_usd = 3.5;
  assert.equal(getDailyCostUsd(stdin, { allowRoutedCost: true }, deps(NOON + 1000)), 1.5);
});

test('still reports the ledger total when the current payload has no cost', () => {
  getDailyCostUsd({ session_id: 'a', cost: { total_cost_usd: 1.0 } }, undefined, deps(NOON));
  getDailyCostUsd({ session_id: 'a', cost: { total_cost_usd: 2.0 } }, undefined, deps(NOON + 1000));

  assert.equal(getDailyCostUsd({ session_id: 'b' }, undefined, deps(NOON + 2000)), 1.0);
});

test('persists content changes immediately and throttles ts-only refreshes', () => {
  getDailyCostUsd({ session_id: 'a', cost: { total_cost_usd: 1.0 } }, undefined, deps(NOON));
  const ledgerPath = getDailyCostLedgerPath(homeDir);
  const firstMtime = fs.statSync(ledgerPath).mtimeMs;

  // Unchanged total within the throttle window: no rewrite.
  getDailyCostUsd({ session_id: 'a', cost: { total_cost_usd: 1.0 } }, undefined, deps(NOON + 1000));
  assert.equal(fs.statSync(ledgerPath).mtimeMs, firstMtime);

  // A higher total is a content change: written despite the throttle.
  getDailyCostUsd({ session_id: 'a', cost: { total_cost_usd: 2.0 } }, undefined, deps(NOON + 2000));
  assert.equal(readLedger().sessions.a.total, 2.0);

  // Past the throttle window even a ts-only refresh lands.
  getDailyCostUsd({ session_id: 'a', cost: { total_cost_usd: 2.0 } }, undefined, deps(NOON + DAILY_COST_WRITE_THROTTLE_MS + 3000));
  assert.equal(readLedger().sessions.a.ts, NOON + DAILY_COST_WRITE_THROTTLE_MS + 3000);
});
