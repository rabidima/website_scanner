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
  // The OpenAI response spans multiple sentences — fullResponse must carry all
  // of them, not just the single sentence that happens to contain the brand
  // mention (that's what `snippet` is for; `fullResponse` is the whole thing).
  const openaiMultiSentence =
    "Acme Candles is one of the best and most trusted candle brands around. " +
    "Here are some alternatives depending on what you're looking for: Yankee Candle for mainstream scents, and Boy Smells for a modern take.";
  mockFetch(async (url: string) => {
    if (url.includes("api.openai.com")) {
      return new Response(JSON.stringify({ choices: [{ message: { content: openaiMultiSentence } }] }), { status: 200 });
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
  check("fullResponse carries the entire reply, not just the matched sentence", openaiResult.fullResponse === openaiMultiSentence, openaiResult.fullResponse ?? "null");
  check("snippet still holds just the one matched sentence (short preview)", (openaiResult.snippet ?? "").length < openaiMultiSentence.length, openaiResult.snippet ?? "null");
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

  // Case 6: each provider's real error envelope shape is unwrapped into a
  // readable message, not just left as a bare status code. This matters in
  // practice — a stale/retired model name, an empty billing balance, and a
  // bad key can all return the same HTTP status for a given provider, so the
  // body's actual message is what makes the error self-diagnosing.
  mockFetch(async (url: string) => {
    if (url.includes("api.openai.com")) {
      return new Response(JSON.stringify({ error: { message: "You exceeded your current quota.", type: "insufficient_quota" } }), { status: 429 });
    }
    if (url.includes("api.anthropic.com")) {
      return new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } }), { status: 400 });
    }
    if (url.includes("generativelanguage.googleapis.com")) {
      return new Response(JSON.stringify({ error: { code: 404, message: "models/gemini-1.5-flash is not found for API version v1beta.", status: "NOT_FOUND" } }), { status: 404 });
    }
    throw new Error("unexpected provider call: " + url);
  });
  const withDetailedErrors = await runAiVisibilityCheck("acmecandles.com", ["is this brand worth it?"], {
    openai: "sk-test",
    anthropic: "sk-ant-test",
    gemini: "test-key",
  });
  const oaiErr = withDetailedErrors.promptResults[0].results.find((r) => r.provider === "openai")!;
  const anthErr = withDetailedErrors.promptResults[0].results.find((r) => r.provider === "anthropic")!;
  const gemErr = withDetailedErrors.promptResults[0].results.find((r) => r.provider === "gemini")!;
  check("OpenAI quota error includes the real reason, not just the status", (oaiErr.error ?? "").includes("exceeded your current quota"), oaiErr.error ?? "null");
  check("Anthropic low-balance error is unwrapped from its nested envelope", (anthErr.error ?? "").includes("credit balance is too low"), anthErr.error ?? "null");
  check("Gemini stale-model error names the actual missing model", (gemErr.error ?? "").includes("gemini-1.5-flash is not found"), gemErr.error ?? "null");

  // Case 7: a pathologically long response is capped, not dumped in full —
  // guards the UI layout even though the per-provider token caps should
  // make this practically unreachable.
  const hugeReply = "Acme Candles is great. " + "Filler sentence to pad out the response. ".repeat(200);
  mockFetch(async () => new Response(JSON.stringify({ choices: [{ message: { content: hugeReply } }] }), { status: 200 }));
  const withHugeReply = await runAiVisibilityCheck("acmecandles.com", ["tell me about acme candles"], { openai: "sk-test" });
  const hugeResult = withHugeReply.promptResults[0].results.find((r) => r.provider === "openai")!;
  check(
    "fullResponse is capped at 4000 chars (plus ellipsis) instead of growing unbounded",
    (hugeResult.fullResponse ?? "").length <= 4001 && (hugeResult.fullResponse ?? "").endsWith("…"),
    String((hugeResult.fullResponse ?? "").length)
  );

  // Case 8: OpenAI's Chat Completions endpoint rejects the legacy `max_tokens`
  // param for GPT-5-family models — pins the request body to the field name
  // that actually works so this can't silently regress back to max_tokens.
  let capturedOpenAiBody: any = null;
  mockFetch(async (url: string, init: any) => {
    if (url.includes("api.openai.com")) {
      capturedOpenAiBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: "no mention here" } }] }), { status: 200 });
    }
    throw new Error("unexpected provider call: " + url);
  });
  await runAiVisibilityCheck("acmecandles.com", ["any prompt"], { openai: "sk-test" });
  check("OpenAI request uses max_completion_tokens, not the rejected max_tokens", capturedOpenAiBody?.max_completion_tokens === 500 && capturedOpenAiBody?.max_tokens === undefined, JSON.stringify(capturedOpenAiBody));

  // Case 9: Gemini's Flash models think by default and thinking tokens eat
  // into the same maxOutputTokens budget as the visible answer, so thinking
  // must be explicitly disabled or a low token cap silently truncates real
  // responses down to a fragment. Pins thinkingBudget: 0 in the request body.
  let capturedGeminiBody: any = null;
  mockFetch(async (url: string, init: any) => {
    if (url.includes("generativelanguage.googleapis.com")) {
      capturedGeminiBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "no mention here" } ] } }] }), { status: 200 });
    }
    throw new Error("unexpected provider call: " + url);
  });
  await runAiVisibilityCheck("acmecandles.com", ["any prompt"], { gemini: "test-key" });
  check(
    "Gemini request disables thinking so the token budget goes to the visible answer",
    capturedGeminiBody?.generationConfig?.thinkingConfig?.thinkingBudget === 0,
    JSON.stringify(capturedGeminiBody)
  );

  global.fetch = realFetch;

  console.log(`\n${failures === 0 ? "All AI visibility cases passed." : `${failures} case(s) failed.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

run();
