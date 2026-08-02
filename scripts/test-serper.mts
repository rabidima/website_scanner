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

  // Case 5: Knowledge Graph, Answer Box, and AI Overview all present, and the
  // scanned domain is one of the AI Overview's cited sources.
  mockFetch(async () =>
    new Response(
      JSON.stringify({
        organic: [{ position: 1, title: "Acme Candles", link: "https://acmecandles.com/" }],
        knowledgeGraph: {
          title: "Acme Candles",
          type: "Candle shop",
          website: "https://acmecandles.com/",
          description: "A small-batch soy candle maker.",
          imageUrl: "https://example.com/acme-logo.png",
          attributes: { Founded: "2019", Headquarters: "Austin, TX" },
        },
        answerBox: {
          title: "Are soy candles better than paraffin?",
          answer: "Soy candles burn cleaner and longer than paraffin candles.",
          link: "https://acmecandles.com/blog/soy-vs-paraffin",
        },
        aiOverview: {
          text: "Soy candles are generally considered better for indoor air quality.",
          sources: [
            { title: "Acme Candles — Soy vs Paraffin", link: "https://acmecandles.com/blog/soy-vs-paraffin" },
            { title: "Candle Science", link: "https://candlescience.com/learning" },
          ],
        },
      }),
      { status: 200 }
    )
  );
  const withSerpFeatures = await checkSeoRank("soy candles", "acmecandles.com", "test-key");
  check("Parses Knowledge Graph title", withSerpFeatures.knowledgeGraph?.title === "Acme Candles");
  check(
    "Parses Knowledge Graph attributes",
    withSerpFeatures.knowledgeGraph?.attributes?.Founded === "2019",
    JSON.stringify(withSerpFeatures.knowledgeGraph?.attributes)
  );
  check("Parses Answer Box answer text", withSerpFeatures.answerBox?.answer?.includes("burn cleaner") ?? false);
  check("Parses AI Overview text", withSerpFeatures.aiOverview?.text?.includes("indoor air quality") ?? false);
  check("Parses AI Overview sources", withSerpFeatures.aiOverview?.sources.length === 2);
  check(
    "Detects the scanned domain is cited in the AI Overview",
    withSerpFeatures.aiOverview?.domainCited === true
  );

  // Case 6: none of the SERP features present in the response — should fall
  // back to null across the board rather than throwing.
  mockFetch(async () =>
    new Response(JSON.stringify({ organic: [{ position: 1, title: "Someone else", link: "https://someone-else.com" }] }), { status: 200 })
  );
  const withoutSerpFeatures = await checkSeoRank("obscure query", "acmecandles.com", "test-key");
  check("Knowledge Graph is null when absent", withoutSerpFeatures.knowledgeGraph === null);
  check("Answer Box is null when absent", withoutSerpFeatures.answerBox === null);
  check("AI Overview is null when absent", withoutSerpFeatures.aiOverview === null);

  // Case 7: AI Overview present but the scanned domain is NOT among its
  // sources — domainCited should be false, not a false positive.
  mockFetch(async () =>
    new Response(
      JSON.stringify({
        organic: [{ position: 1, title: "Someone else", link: "https://someone-else.com" }],
        aiOverview: {
          text: "General overview text.",
          sources: [{ title: "Other Site", link: "https://other-site.com/article" }],
        },
      }),
      { status: 200 }
    )
  );
  const notCited = await checkSeoRank("obscure query", "acmecandles.com", "test-key");
  check("domainCited is false when the domain isn't among AI Overview sources", notCited.aiOverview?.domainCited === false);

  global.fetch = realFetch;

  console.log(`\n${failures === 0 ? "All Serper cases passed." : `${failures} case(s) failed.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

run();
