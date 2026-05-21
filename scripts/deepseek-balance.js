#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';

const DEEPSEEK_API_URL = 'https://api.deepseek.com/user/balance';

function printHelp() {
  process.stdout.write(`Usage: deepseek-balance.js [options]

Fetch DeepSeek account balance and output as an ExternalUsageSnapshot JSON
for use with claude-hud's display.externalUsagePath.

Options:
  --output <path>  Write JSON to file instead of stdout
  --help           Show this help message

Environment Variables:
  DEEPSEEK_API_KEY         DeepSeek API key (primary)
  ANTHROPIC_AUTH_TOKEN     Fallback if DEEPSEEK_API_KEY is not set

Output format:
  {
    "updated_at": 1779356358855,
    "balance_label": "余额 ¥108.50",
    "five_hour": null,
    "seven_day": null
  }

Exit codes:
  0  Success
  1  Error (missing key, network failure, unexpected response)
`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  let outputPath = null;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--help':
        printHelp();
        process.exit(0);
      case '--output':
        i++;
        if (i >= args.length) {
          console.error('Error: --output requires a path argument');
          process.exit(1);
        }
        outputPath = args[i];
        break;
      default:
        if (args[i].startsWith('--')) {
          console.error(`Error: Unknown option: ${args[i]}`);
        } else {
          console.error(`Error: Unexpected argument: ${args[i]}`);
        }
        console.error('Use --help for usage information.');
        process.exit(1);
    }
  }

  return { outputPath };
}

function getApiKey() {
  const key = process.env.DEEPSEEK_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
  if (!key || typeof key !== 'string' || !key.trim()) {
    console.error(
      'Error: No API key found.\n' +
      'Set the DEEPSEEK_API_KEY environment variable.\n' +
      '(ANTHROPIC_AUTH_TOKEN is also accepted as a fallback.)',
    );
    process.exit(1);
  }
  return key.trim();
}

function formatBalanceLabel(totalBalance, currency) {
  let symbol;
  switch (currency) {
    case 'RMB':
    case 'CNY':
      symbol = '¥';
      break;
    case 'USD':
      symbol = '$';
      break;
    default:
      symbol = `${currency} `;
  }

  const formatted = Number(totalBalance).toFixed(2);
  return `余额 ${symbol}${formatted}`;
}

async function fetchBalance(apiKey) {
  let response;
  try {
    response = await fetch(DEEPSEEK_API_URL, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
    });
  } catch (cause) {
    throw new Error(`Network error while calling DeepSeek API: ${cause.message}`);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const snippet = body ? `: ${body.replace(/[\x00-\x1f]/g, ' ').slice(0, 200)}` : '';
    throw new Error(`DeepSeek API returned HTTP ${response.status}${snippet}`);
  }

  let data;
  try {
    data = await response.json();
  } catch (cause) {
    throw new Error(`Failed to parse DeepSeek API response: ${cause.message}`);
  }

  if (!data || typeof data !== 'object') {
    throw new Error('DeepSeek API returned non-object response');
  }

  if (!Array.isArray(data.balance_infos) || data.balance_infos.length === 0) {
    const snippet = JSON.stringify(data).slice(0, 200);
    throw new Error(`Unexpected API response (missing balance_infos): ${snippet}`);
  }

  const balanceInfo = data.balance_infos[0];
  if (!balanceInfo || typeof balanceInfo !== 'object') {
    throw new Error('Invalid balance entry in API response');
  }

  const totalBalance = balanceInfo.total_balance;
  if (totalBalance == null) {
    throw new Error('Missing total_balance in API response');
  }

  const numericBalance = Number(totalBalance);
  if (!Number.isFinite(numericBalance)) {
    throw new Error(`Invalid total_balance value: ${JSON.stringify(totalBalance)}`);
  }

  const currency = typeof balanceInfo.currency === 'string' && balanceInfo.currency
    ? balanceInfo.currency
    : 'RMB';

  return {
    updated_at: Date.now(),
    balance_label: formatBalanceLabel(numericBalance, currency),
    five_hour: null,
    seven_day: null,
  };
}

async function main() {
  const { outputPath } = parseArgs();
  const apiKey = getApiKey();
  const snapshot = await fetchBalance(apiKey);
  const json = JSON.stringify(snapshot, null, 2) + '\n';

  if (outputPath) {
    const dir = path.dirname(outputPath);
    if (dir) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(outputPath, json, 'utf8');
  } else {
    process.stdout.write(json);
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
