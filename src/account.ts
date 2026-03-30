import fs from 'node:fs';
import os from 'node:os';
import { getClaudeConfigJsonPath } from './claude-config-dir.js';
import { createDebug } from './debug.js';

const debug = createDebug('account');

export interface AccountInfo {
  email: string;
  displayName?: string;
  orgName?: string;
}

type AccountReader = (configPath: string) => AccountInfo | null;

let cachedMtimeMs: number | undefined;
let cachedAccountInfo: AccountInfo | null = null;

function defaultReadAccount(configPath: string): AccountInfo | null {
  const content = fs.readFileSync(configPath, 'utf-8');
  const config = JSON.parse(content);
  const oauth = config.oauthAccount;

  if (!oauth || typeof oauth.emailAddress !== 'string') {
    debug('No oauthAccount or emailAddress in config');
    return null;
  }

  return {
    email: oauth.emailAddress,
    displayName: typeof oauth.displayName === 'string' ? oauth.displayName : undefined,
    orgName: typeof oauth.organizationName === 'string' ? oauth.organizationName : undefined,
  };
}

let readAccount: AccountReader = defaultReadAccount;

export async function getAccountInfo(): Promise<AccountInfo | null> {
  // getClaudeConfigJsonPath appends ".json" to the config directory,
  // producing e.g. ~/.claude.json (a sibling of ~/.claude/).
  const configPath = getClaudeConfigJsonPath(os.homedir());

  try {
    const stat = fs.statSync(configPath);
    if (stat.mtimeMs === cachedMtimeMs) {
      return cachedAccountInfo;
    }

    cachedMtimeMs = stat.mtimeMs;
    cachedAccountInfo = readAccount(configPath);
    return cachedAccountInfo;
  } catch (error) {
    debug('Failed to read account info:', error);
    return null;
  }
}

export function formatAccountLabel(info: AccountInfo): string {
  const { email, displayName, orgName } = info;

  // If org name is distinct from the email (i.e. not a personal org), show it
  const emailPrefix = email.split('@')[0];
  const hasDistinctOrg = orgName
    && !orgName.includes(emailPrefix)
    && orgName !== email;

  if (displayName && hasDistinctOrg) {
    return `${displayName} @ ${orgName}`;
  }

  if (hasDistinctOrg) {
    return `${emailPrefix} @ ${orgName}`;
  }

  return email;
}

export function _resetAccountCache(): void {
  cachedMtimeMs = undefined;
  cachedAccountInfo = null;
}

export function _setAccountReaderForTests(reader: AccountReader | null): void {
  readAccount = reader ?? defaultReadAccount;
}
