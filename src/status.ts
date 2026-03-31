import * as https from "node:https";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getHudPluginDir } from "./claude-config-dir.js";
import type { StatusData } from "./types.js";

const CACHE_FILENAME = ".claude-status-cache.json";
const CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 3000;
const STATUS_API_URL = "https://status.claude.com/api/v2/summary.json";
const CLAUDE_CODE_COMPONENT_ID = "yyzkbfz2thpt";

let hasResolved = false;
let cachedResult: StatusData | null = null;

function getCachePath(homeDir: string): string {
  return path.join(getHudPluginDir(homeDir), CACHE_FILENAME);
}

function readCache(homeDir: string): StatusData | null {
  try {
    const cachePath = getCachePath(homeDir);
    if (!fs.existsSync(cachePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(cachePath, "utf8")) as StatusData;
    if (
      typeof parsed.status !== "string" ||
      typeof parsed.fetchedAt !== "number"
    )
      return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(homeDir: string, data: StatusData): void {
  try {
    const cachePath = getCachePath(homeDir);
    fs.writeFileSync(cachePath, JSON.stringify(data), "utf8");
  } catch {
    // Ignore write failures
  }
}

type FetchImpl = () => Promise<StatusData>;

let fetchImpl: FetchImpl = fetchApi;

function fetchApi(): Promise<StatusData> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      STATUS_API_URL,
      { timeout: FETCH_TIMEOUT_MS },
      (res) => {
        let body = "";
        res.on("data", (chunk: string) => {
          body += chunk;
        });
        res.on("end", () => {
          try {
            const json = JSON.parse(body);
            const component = json.components?.find(
              (c: { id: string }) => c.id === CLAUDE_CODE_COMPONENT_ID,
            );
            const incident = json.incidents?.[0];
            resolve({
              status: component?.status ?? "operational",
              activeIncident: incident?.name ?? null,
              fetchedAt: Date.now(),
            });
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
  });
}

export async function getServiceStatus(): Promise<StatusData | null> {
  if (hasResolved) return cachedResult;

  const homeDir = os.homedir();
  const diskCache = readCache(homeDir);

  if (diskCache && Date.now() - diskCache.fetchedAt < CACHE_TTL_MS) {
    hasResolved = true;
    cachedResult = diskCache;
    return cachedResult;
  }

  try {
    const fresh = await fetchImpl();
    writeCache(homeDir, fresh);
    hasResolved = true;
    cachedResult = fresh;
    return cachedResult;
  } catch {
    // Fall back to stale cache
    hasResolved = true;
    cachedResult = diskCache;
    return cachedResult;
  }
}

export function _resetStatusCache(): void {
  hasResolved = false;
  cachedResult = null;
}

export function _setFetchImplForTests(impl: FetchImpl | null): void {
  fetchImpl = impl ?? fetchApi;
}
