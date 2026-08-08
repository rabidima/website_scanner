/**
 * Offline test for lib/recent-scans.ts. Injects a fake in-memory KvListClient
 * (mimicking Redis LPUSH/LTRIM/LRANGE semantics) instead of talking to real
 * Vercel KV — no network involved.
 * Run with: npx tsx scripts/test-recent-scans.mts
 */
const { createRecentScansStore } = await import("../lib/recent-scans");

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  console.log(`${cond ? "PASS" : "FAIL"} — ${label}${detail ? ` (${detail})` : ""}`);
  if (!cond) failures++;
}

class FakeKvListClient {
  private lists = new Map<string, unknown[]>();

  async lpush(key: string, value: unknown): Promise<number> {
    const list = this.lists.get(key) ?? [];
    list.unshift(value);
    this.lists.set(key, list);
    return list.length;
  }

  async ltrim(key: string, start: number, stop: number): Promise<string> {
    const list = this.lists.get(key) ?? [];
    this.lists.set(key, list.slice(start, stop + 1));
    return "OK";
  }

  async lrange<T>(key: string, start: number, stop: number): Promise<T[]> {
    const list = this.lists.get(key) ?? [];
    return list.slice(start, stop + 1) as T[];
  }

  // Test-only escape hatch to seed data that doesn't go through record(),
  // simulating whatever a real Redis instance might hand back.
  seed(key: string, values: unknown[]) {
    this.lists.set(key, values);
  }
}

async function run() {
  // Case 1: a single recorded scan round-trips through list().
  const client1 = new FakeKvListClient();
  const store1 = createRecentScansStore(client1 as any);
  await store1.record({ domain: "acmecandles.com", technologies: ["Shopify", "Klaviyo"], scannedAt: "2026-08-08T10:00:00.000Z" });
  const list1 = await store1.list();
  check("Recorded scan round-trips", list1.length === 1 && list1[0].domain === "acmecandles.com", JSON.stringify(list1));

  // Case 2: newest scan appears first (LPUSH semantics).
  await store1.record({ domain: "second.com", technologies: [], scannedAt: "2026-08-08T10:01:00.000Z" });
  const list2 = await store1.list();
  check("Newest scan is first in the list", list2[0].domain === "second.com" && list2[1].domain === "acmecandles.com");

  // Case 3: more than 5 records — only the 5 most recent survive (LTRIM).
  const client2 = new FakeKvListClient();
  const store2 = createRecentScansStore(client2 as any);
  for (let i = 1; i <= 8; i++) {
    await store2.record({ domain: `site${i}.com`, technologies: [], scannedAt: `2026-08-08T10:0${i}:00.000Z` });
  }
  const list3 = await store2.list();
  check("List is capped at 5 entries", list3.length === 5, `got ${list3.length}`);
  check("Cap keeps the 5 most recent (newest first)", list3.map((s) => s.domain).join(",") === "site8.com,site7.com,site6.com,site5.com,site4.com", list3.map((s) => s.domain).join(","));

  // Case 4: entries stored as raw JSON strings (what our own record() writes)
  // parse back into objects correctly.
  const client3 = new FakeKvListClient();
  client3.seed("recent-scans", [JSON.stringify({ domain: "stringy.com", technologies: ["WordPress"], scannedAt: "2026-08-08T09:00:00.000Z" })]);
  const store3 = createRecentScansStore(client3 as any);
  const list4 = await store3.list();
  check("JSON-string entries parse back into objects", list4.length === 1 && list4[0].domain === "stringy.com");

  // Case 5: entries already deserialized into objects by the client (some
  // Upstash client configs auto-parse) are handled without double-parsing.
  const client4 = new FakeKvListClient();
  client4.seed("recent-scans", [{ domain: "already-object.com", technologies: [], scannedAt: "2026-08-08T09:00:00.000Z" }]);
  const store4 = createRecentScansStore(client4 as any);
  const list5 = await store4.list();
  check("Pre-parsed object entries are handled without double-parsing", list5.length === 1 && list5[0].domain === "already-object.com");

  // Case 6: garbage entries (invalid JSON, or JSON missing required fields)
  // are filtered out rather than throwing or polluting the list.
  const client5 = new FakeKvListClient();
  client5.seed("recent-scans", [
    "not valid json{{{",
    JSON.stringify({ domain: "valid.com", technologies: [], scannedAt: "2026-08-08T09:00:00.000Z" }),
    JSON.stringify({ technologies: [], scannedAt: "2026-08-08T09:00:00.000Z" }), // missing domain
    null,
    42,
  ]);
  const store5 = createRecentScansStore(client5 as any);
  const list6 = await store5.list();
  check("Garbage/malformed entries are filtered out, doesn't throw", list6.length === 1 && list6[0].domain === "valid.com", JSON.stringify(list6));

  console.log(`\n${failures === 0 ? "All recent-scans cases passed." : `${failures} case(s) failed.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

run();
