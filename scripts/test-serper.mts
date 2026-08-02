/**
 * Offline test for lib/serper.ts. Mocks global.fetch.
 * Run with: npx tsx scripts/test-serper.mts
 */
import { checkSeoRank, SerperError } from "../lib/serper";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  console.log(`${cond ? "PASS" : "FAIL"} — ${label}${detail ? ` (${detail})` : ""}`);
  if (!cond) failures++;
}

const realFetch = global.fetch;
function mockFetch(handler: () => Promise<Response>) {
  // @ts-expect-error test-only override
  global.fetch = handler;
}

async function run() {
  // Case 1: domain found at position 4, plus related searches / PAA mapped.
  mockFetch(async () =>
    new Response(
      JSON.stringify({
        organic: [
          { position: 1, title: "Competitor A", link: "https://competitor-a.com/candles" },
          { position: 2, title: "Competitor B", link: "https://competitor-b.com" },
          { position: 3, title: "Competitor C", link: "https://competitor-c.com" },
          { position: 4, title: "Acme Candles — Handmade Soy Candles", link: "https://acmecandles.com/", snippet: "Small-batch soy candles." },
        ],
        relatedSearches: [{ query: "best soy candles" }, { query: "handmade candles near me" }],
        peopleAlsoAsk: [{ question: "Are soy candles better than paraffin?" }],
      }),
      { status: 200 }
    )
  );
  const found = await checkSeoRank("handmade candles", "acmecandles.com", "test-key");
  check("Finds the domain's rank position", found.rank === 4, String(found.rank));
  check("Returns the matched URL", found.matchedUrl === "https://acmecandles.com/", found.matchedUrl ?? "null");
  check("Returns top 10 organic results", found.topResults.length === 4);
  check("Maps related searches", found.relatedSearches.length === 2 && found.relatedSearches[0] === "best soy candles");
  check("Maps People Also Ask questions", found.peopleAlsoAsk.length === 1);

  // Case 2: domain not present in the returned results.
  mockFetch(async () =>
    new Response(JSON.stringify({ organic: [{ position: 1, title: "Someone else", link: "https://someone-else.com" }] }), { status: 200 })
  );
  const notFound = await checkSeoRank("handmade candles", "acmecandles.com", "test-key");
  check("Reports rank null when the domain isn't in the results", notFound.rank === null);

  // Case 3: invalid API key surfaces a clear error, not a generic one.
  mockFetch(async () => new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 }));
  let authError: unknown = null;
  try {
    await checkSeoRank("handmade candles", "acmecandles.com", "bad-key");
  } catch (err) {
    authError = err;
  }
  check(
    "401 surfaces an invalid-API-key message",
    authError instanceof SerperError && /invalid/i.test((authError as SerperError).message),
    String(authError)
  );

  // Case 4: rate limit / credit exhaustion.
  mockFetch(async () => new Response(JSON.stringify({}), { status: 429 }));
  let rateError: unknown = null;
  try {
    await checkSeoRank("handmade candles", "acmecandles.com", "test-key");
  } catch (err) {
    rateError = err;
  }
  check("429 surfaces a rate-limit message", rateError instanceof SerperError && /rate limit|credit/i.test((rateError as SerperError).message));

  global.fetch = realFetch;

  console.log(`\n${failures === 0 ? "All Serper cases passed." : `${failures} case(s) failed.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

run();
