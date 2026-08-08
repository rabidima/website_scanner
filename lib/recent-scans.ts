import { Redis } from "@upstash/redis";

// See lib/gate.ts for why this is @upstash/redis directly rather than the
// discontinued @vercel/kv package.
const kv = Redis.fromEnv();

/**
 * Global "most recently scanned sites" feed for the trust strip on the
 * MarketPulse page. This is intentionally public-across-all-visitors social
 * proof (domain + detected tech, nothing personal, no email) — every
 * completed scan counts, free or verified.
 *
 * Backed by Vercel KV (a Redis list) rather than in-memory: this list has to
 * be consistent across every serverless instance simultaneously — unlike the
 * free-scan gate, there's no per-IP scoping that could paper over instances
 * not sharing state. An in-memory version here would show a different,
 * incomplete list depending on which instance served the request.
 */

const KEY = "recent-scans";
const MAX_ENTRIES = 5;

export interface RecentScan {
  domain: string;
  technologies: string[];
  scannedAt: string; // ISO 8601
}

export interface RecentScansStore {
  record(scan: RecentScan): Promise<void>;
  list(): Promise<RecentScan[]>;
}

function isRecentScan(value: unknown): value is RecentScan {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as RecentScan).domain === "string" &&
    typeof (value as RecentScan).scannedAt === "string" &&
    Array.isArray((value as RecentScan).technologies)
  );
}

/** Just the list primitives this module needs — lets tests inject an
 *  in-memory fake instead of talking to real Vercel KV. */
export interface KvListClient {
  lpush(key: string, value: string): Promise<unknown>;
  ltrim(key: string, start: number, stop: number): Promise<unknown>;
  lrange<T = unknown>(key: string, start: number, stop: number): Promise<T[]>;
}

class KvRecentScansStore implements RecentScansStore {
  constructor(private client: KvListClient) {}

  async record(scan: RecentScan): Promise<void> {
    await this.client.lpush(KEY, JSON.stringify(scan));
    // Keep only the newest MAX_ENTRIES — trims from the tail every write so
    // the list never grows unbounded.
    await this.client.ltrim(KEY, 0, MAX_ENTRIES - 1);
  }

  async list(): Promise<RecentScan[]> {
    const raw = await this.client.lrange<unknown>(KEY, 0, MAX_ENTRIES - 1);
    return raw
      .map((entry) => {
        // @vercel/kv (Upstash Redis under the hood) auto-parses JSON-shaped
        // strings back into objects on read in some configurations but not
        // others depending on client version — handle both defensively
        // rather than assume one behavior.
        if (typeof entry === "string") {
          try {
            return JSON.parse(entry);
          } catch {
            return null;
          }
        }
        return entry;
      })
      .filter(isRecentScan);
  }
}

/** Exposed for tests — build a store over any KvListClient, real or fake. */
export function createRecentScansStore(client: KvListClient): RecentScansStore {
  return new KvRecentScansStore(client);
}

export const recentScansStore: RecentScansStore = createRecentScansStore(kv);

/** Fire-and-forget record — a KV hiccup should never fail or slow down the
 *  actual scan response, this is purely a nice-to-have trust strip. */
export function recordRecentScanBestEffort(scan: RecentScan): void {
  recentScansStore.record(scan).catch((err) => {
    console.error("Recent-scans KV write failed (non-blocking):", scan.domain, err);
  });
}
