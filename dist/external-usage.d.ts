import * as fs from 'node:fs';
import type { HudConfig } from './config.js';
import type { UsageData } from './types.js';
export declare const EXTERNAL_USAGE_WRITE_THROTTLE_MS = 30000;
type FileSystemDeps = Pick<typeof fs, 'chmodSync' | 'readFileSync' | 'renameSync' | 'rmSync' | 'statSync' | 'writeFileSync'>;
export declare function writeExternalUsageSnapshot(config: HudConfig, usage: UsageData | null, now?: number, deps?: FileSystemDeps): boolean;
export declare function getUsageFromExternalSnapshot(config: HudConfig, now?: number): UsageData | null;
export declare function resolveUsage(config: HudConfig, stdinUsage: UsageData | null, now?: number): UsageData | null;
export {};
//# sourceMappingURL=external-usage.d.ts.map