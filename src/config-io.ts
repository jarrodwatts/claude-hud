import fs from 'node:fs';
import path from 'node:path';
import { getConfigPath } from './config.js';

export function exportConfig(): string {
  try {
    return fs.readFileSync(getConfigPath(), 'utf-8');
  } catch {
    return '{}';
  }
}

export function importConfig(jsonString: string): { success: boolean; error?: string } {
  try {
    const parsed = JSON.parse(jsonString);
    if (typeof parsed !== 'object' || parsed === null) {
      return { success: false, error: 'Invalid config: must be a JSON object' };
    }
    const dir = path.dirname(getConfigPath());
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getConfigPath(), JSON.stringify(parsed, null, 2));
    return { success: true };
  } catch (e) {
    return { success: false, error: `Parse error: ${(e as Error).message}` };
  }
}
