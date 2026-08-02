/**
 * Offline test for lib/ai-visibility.ts. Mocks global.fetch — differentiates
 * by request URL so each of the 4 providers can return distinct canned
 * responses in the same test run.
 * Run with: npx tsx scripts/test-ai-visibility.mts
 */
import { runAiVisibilityCheck } from "../lib/ai-visibility";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  console.log(`${cond ? "PASS" : "FAIL"} — ${label}${detail ? ` (${detail})` : ""}`);
  if (!cond) failures++;
}

const realFetch = global.fetch;
function mockFetch(handler: (url: string, init: any) => Promise<Response>) {
  // @ts-expect-error test-only override
  global.fetch = handler;
}

async function run() {
  // Case 1: no API keys configured at all — every provider reports
  // configured:false, nothing is actually queried over the network.
  mockFetch(async () => {
    throw new Error("should not be called");
  });
  const noKeys = await runAiVisibilityCheck("acmecandles.com", ["best candle brands"], {});
  const allUnconfigured = noKeys.promptResults[0].results.every((r) => r.configured === false);
  check("Reports every provider as not configured when no keys are set", allUnconfigured, JSON.stringify(noKeys.promptResults[0].results.map((r) => r.provider + ":" + r.configured)));
  check("Mention rates show 0 queried when unconfigured", noKeys.mentionRates.every((r) => r.queriedCount === 0));

  // Case 2: OpenAI mentions the brand positively; Anthropic doesn't mention it.
  mockFetch(async (url: string) => {
    if (url.includes("api.openai.com")) {
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "Acme Candles is one of the best and most trusted candle brands around." } }] }),
        { status: 200 }
      );
    }
    if (url.includes("api.anthropic.com")) {
      return new Response(JSON.stringify({ content: [{ text: "I don't have a specific recommendation." }] }), { status: 200 });
    }
    throw new Error("unexpected provider call: " + url);
  });
  const mixed = await runAiVisibilityCheck("acmecandles.com", ["best candle brands"], {
    openai: "sk-test",
    anthropic: "sk-ant-test",
  });
  const openaiResult = mixed.promptResults[0].results.find((r) => r.provider === "openai")!;
  const anthropicResult = mixed.promptResults[0].results.find((r) => r.provider === "anthropic")!;
  check("Detects a mention and positive sentiment from OpenAI", openaiResult.mentioned === true && openaiResult.sentiment === "positive", JSON.stringify(openaiResult));
  check("Detects no mention from Anthropic", anthropicResult.mentioned === false, JSON.stringify(anthropicResult));
  check("Mention rate reflects 1/1 for openai, 0/1 for anthropic", mixed.mentionRates.find((r) => r.provider === "openai")!.mentionedCount === 1 && mixed.mentionRates.find((r) => r.provider === "anthropic")!.mentionedCount === 0);

  // Case 3: Perplexity's structured citations field is used directly rather
  // than regex-extracted, and should be preferred when present.
  mockFetch(async (url: string) => {
    if (url.includes("api.perplexity.ai")) {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "Acme Candles is a well-reviewed small-batch candle maker." } }],
          citations: ["https://acmecandles.com/reviews", "https://otherblog.com/candles"],
        }),
        { status: 200 }
      );
    }
    throw new Error("unexpected provider call: " + url);
  });
  const withCitation = await runAiVisibilityCheck("acmecandles.com", ["is acme candles good"], { perplexity: "pplx-test" });
  const perplexityResult = withCitation.promptResults[0].results.find((r) => r.provider === "perplexity")!;
  check("Uses Perplexity's structured citations to find a cited URL", perplexityResult.citedUrl === "https://acmecandles.com/reviews", JSON.stringify(perplexityResult));

  // Case 4: a provider request failing (e.g. bad key) is captured as an
  // error on that provider, not thrown — the rest of the check still works.
  mockFetch(async (url: string) => {
    if (url.includes("api.openai.com")) {
      return new Response(JSON.stringify({ error: "invalid key" }), { status: 401 });
    }
    throw new Error("unexpected provider call: " + url);
  });
  const withError = await runAiVisibilityCheck("acmecandles.com", ["best candle brands"], { openai: "bad-key" });
  const errored = withError.promptResults[0].results.find((r) => r.provider === "openai")!;
  check("Provider errors are captured per-provider, not thrown", errored.configured === true && errored.error !== null && errored.mentioned === false, JSON.stringify(errored));

  // Case 5: more than 5 prompts submitted — only the first 5 are used.
  mockFetch(async () => new Response(JSON.stringify({ choices: [{ message: { content: "no mention here" } }] }), { status: 200 }));
  const manyPrompts = Array.from({ length: 8 }, (_, i) => `prompt ${i + 1}`);
  const capped = await runAiVisibilityCheck("acmecandles.com", manyPrompts, { openai: "sk-test" });
  check("Caps prompts at 5 even when more are submitted", capped.promptResults.length === 5, String(capped.promptResults.length));

  global.fetch = realFetch;

  console.log(`\n${failures === 0 ? "All AI visibility cases passed." : `${failures} case(s) failed.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

run();
