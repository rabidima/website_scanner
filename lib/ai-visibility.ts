// DIY AI-visibility checker: queries the LLM providers directly (no data-reseller
// markup) with a small set of tracked prompts, and checks whether a brand/domain
// gets mentioned in the response. This is an on-demand snapshot, not a historical
// tracker — there's no database yet, so results aren't persisted between calls.
//
// Each provider is independently optional: if its API key isn't configured, we
// report that clearly instead of failing the whole check. This lets an agency
// start with just one or two providers and add the rest later.

export type AiProvider = "openai" | "anthropic" | "gemini" | "perplexity";

export const PROVIDER_LABELS: Record<AiProvider, string> = {
  openai: "ChatGPT (OpenAI)",
  anthropic: "Claude (Anthropic)",
  gemini: "Gemini (Google)",
  perplexity: "Perplexity",
};

export type Sentiment = "positive" | "neutral" | "negative";

export interface ProviderResult {
  provider: AiProvider;
  configured: boolean;
  mentioned: boolean;
  snippet: string | null;
  fullResponse: string | null;
  citedUrl: string | null;
  sentiment: Sentiment | null;
  error: string | null;
}

// Safety cap on how much of a provider's raw response we carry through to the
// UI — generous enough that it should never actually trigger given the
// output-token caps each provider call sets below, but guards against a
// single runaway response blowing up the layout.
const MAX_FULL_RESPONSE_CHARS = 4000;

export interface PromptResult {
  prompt: string;
  results: ProviderResult[];
}

export interface ProviderMentionRate {
  provider: AiProvider;
  mentionedCount: number;
  queriedCount: number;
}

export interface AiVisibilityResult {
  domain: string;
  brand: string;
  promptResults: PromptResult[];
  mentionRates: ProviderMentionRate[];
}

export interface ApiKeys {
  openai?: string;
  anthropic?: string;
  gemini?: string;
  perplexity?: string;
}

const TIMEOUT_MS = 25_000;
const MAX_PROMPTS = 5;

// Deliberately simple keyword-based heuristic, not a real NLP sentiment model —
// documented as such in the UI. Good enough to flag "this response reads
// positively/negatively about the brand" for a quick MVP signal.
const POSITIVE_WORDS = [
  "best", "great", "excellent", "recommend", "trusted", "reliable", "leading",
  "popular", "top", "favorite", "innovative", "quality", "outstanding", "praised",
];
const NEGATIVE_WORDS = [
  "worst", "bad", "avoid", "complaint", "unreliable", "poor", "scam", "issue",
  "problem", "disappointing", "warning", "lawsuit", "criticized", "controversy",
];

function brandFromDomain(domain: string): string {
  const host = domain.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0];
  const parts = host.split(".");
  // Strip the TLD (and a second-level ccTLD like .co.il / .co.uk if present).
  return parts.length > 2 && parts[parts.length - 2].length <= 3
    ? parts.slice(0, -2).join(".")
    : parts.slice(0, -1).join(".");
}

// Strips everything but letters/digits so "Acme Candles", "acme-candles", and
// "acmecandles" all normalize to the same needle. This matters a lot in
// practice: brand names in domains are usually written with no separators
// ("acmecandles.com"), but LLM prose almost always writes them with a space
// ("Acme Candles") — a plain substring match against the domain-derived
// needle would silently miss the overwhelming majority of real mentions.
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

function findMention(text: string, domain: string, brand: string): { mentioned: boolean; snippet: string | null; matchIndex: number } {
  const host = domain.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0];
  const needles = [normalize(host.replace(/\.[a-z.]+$/i, "")), normalize(brand)].filter((n) => n.length >= 3);
  if (needles.length === 0) return { mentioned: false, snippet: null, matchIndex: -1 };

  // Also check the raw domain (with TLD) directly against the raw text —
  // catches cases where the model cites the literal domain/URL rather than
  // writing out the brand name in prose.
  const rawHaystack = text.toLowerCase();
  const rawDomainIdx = rawHaystack.indexOf(host.toLowerCase());
  if (rawDomainIdx !== -1) {
    const sentences = splitSentences(text);
    const hit = sentences.find((s) => s.toLowerCase().includes(host.toLowerCase())) ?? text.slice(Math.max(0, rawDomainIdx - 80), rawDomainIdx + 120);
    return { mentioned: true, snippet: hit.length > 300 ? hit.slice(0, 300) + "…" : hit, matchIndex: rawDomainIdx };
  }

  // Sentence-by-sentence normalized scan — handles spacing/punctuation/case
  // differences between the domain slug and how a brand name reads in prose.
  const sentences = splitSentences(text);
  for (const sentence of sentences) {
    const normalizedSentence = normalize(sentence);
    if (needles.some((needle) => normalizedSentence.includes(needle))) {
      const matchIndex = text.indexOf(sentence);
      return {
        mentioned: true,
        snippet: sentence.length > 300 ? sentence.slice(0, 300) + "…" : sentence,
        matchIndex: matchIndex === -1 ? 0 : matchIndex,
      };
    }
  }

  return { mentioned: false, snippet: null, matchIndex: -1 };
}

function scoreSentiment(text: string, matchIndex: number): Sentiment {
  const windowStart = Math.max(0, matchIndex - 150);
  const windowEnd = Math.min(text.length, matchIndex + 150);
  const window = text.slice(windowStart, windowEnd).toLowerCase();
  const positiveHits = POSITIVE_WORDS.filter((w) => window.includes(w)).length;
  const negativeHits = NEGATIVE_WORDS.filter((w) => window.includes(w)).length;
  if (positiveHits > negativeHits) return "positive";
  if (negativeHits > positiveHits) return "negative";
  return "neutral";
}

function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s)"'\]]+/g);
  return matches ? matches.map((u) => u.replace(/[.,;:]+$/, "")) : [];
}

function findCitedUrl(urls: string[], domain: string): string | null {
  const host = domain.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0];
  return urls.find((u) => u.toLowerCase().includes(host.toLowerCase())) ?? null;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Each queryX function returns the raw response text plus any URLs the
// provider explicitly cited (only some providers surface these structurally —
// the rest fall back to regex-extracting URLs from the response text).
interface RawQueryResult {
  text: string;
  citations: string[];
}

// Pulls the actual error message out of a failed provider response instead of
// just the HTTP status code. Every provider shapes its error body slightly
// differently (OpenAI/Perplexity: error.message, Anthropic: error.message
// under a different envelope, Gemini: error.message too but nested one level
// deeper) — this tries the common shapes and falls back to a raw text
// snippet, then the bare status, so a stale model name (404), an empty
// billing balance (429/400 depending on provider), or a bad key (401) are
// distinguishable at a glance instead of all looking like "error (xxx)".
async function describeApiError(res: Response, providerLabel: string): Promise<string> {
  let detail = "";
  try {
    const body = await res.clone().json();
    detail =
      body?.error?.message ||
      body?.error?.error?.message ||
      body?.message ||
      (typeof body?.error === "string" ? body.error : "");
  } catch {
    try {
      const raw = await res.text();
      detail = raw.slice(0, 200);
    } catch {
      detail = "";
    }
  }
  return detail ? `${providerLabel} API error (${res.status}): ${detail}` : `${providerLabel} API error (${res.status})`;
}

async function queryOpenAi(prompt: string, apiKey: string): Promise<RawQueryResult> {
  const model = process.env.OPENAI_MODEL || "gpt-5-mini";
  const res = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    // GPT-5-family models reject the legacy `max_tokens` param and require
    // `max_completion_tokens` instead — this only applies to OpenAI's Chat
    // Completions endpoint, the other three providers are unaffected.
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], max_completion_tokens: 500 }),
  });
  if (!res.ok) throw new Error(await describeApiError(res, "OpenAI"));
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content ?? "";
  return { text, citations: [] };
}

async function queryAnthropic(prompt: string, apiKey: string): Promise<RawQueryResult> {
  const model = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
  const res = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, max_tokens: 500, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) throw new Error(await describeApiError(res, "Anthropic"));
  const data = await res.json();
  const text = data?.content?.[0]?.text ?? "";
  return { text, citations: [] };
}

async function queryGemini(prompt: string, apiKey: string): Promise<RawQueryResult> {
  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash";
  const res = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Gemini's Flash models think by default, and thinking tokens are
      // deducted from the same maxOutputTokens budget rather than a separate
      // pool — with thinking left on, a 500-token cap gets mostly consumed by
      // internal reasoning, leaving only a truncated fragment of the actual
      // answer. thinkingBudget: 0 turns thinking off entirely for this
      // simple "does the brand get mentioned" query, where we don't need it.
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 500, thinkingConfig: { thinkingBudget: 0 } },
      }),
    }
  );
  if (!res.ok) throw new Error(await describeApiError(res, "Gemini"));
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return { text, citations: [] };
}

async function queryPerplexity(prompt: string, apiKey: string): Promise<RawQueryResult> {
  const model = process.env.PERPLEXITY_MODEL || "sonar";
  const res = await fetchWithTimeout("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], max_tokens: 500 }),
  });
  if (!res.ok) throw new Error(await describeApiError(res, "Perplexity"));
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content ?? "";
  // Sonar models return a top-level "citations" array of source URLs.
  const citations = Array.isArray(data?.citations) ? data.citations : [];
  return { text, citations };
}

const PROVIDER_QUERIES: Record<AiProvider, (prompt: string, apiKey: string) => Promise<RawQueryResult>> = {
  openai: queryOpenAi,
  anthropic: queryAnthropic,
  gemini: queryGemini,
  perplexity: queryPerplexity,
};

async function runProvider(
  provider: AiProvider,
  prompt: string,
  apiKey: string | undefined,
  domain: string,
  brand: string
): Promise<ProviderResult> {
  if (!apiKey) {
    return { provider, configured: false, mentioned: false, snippet: null, fullResponse: null, citedUrl: null, sentiment: null, error: null };
  }
  try {
    const { text, citations } = await PROVIDER_QUERIES[provider](prompt, apiKey);
    const { mentioned, snippet, matchIndex } = findMention(text, domain, brand);
    if (!mentioned) {
      return { provider, configured: true, mentioned: false, snippet: null, fullResponse: null, citedUrl: null, sentiment: null, error: null };
    }
    const sentiment = scoreSentiment(text, matchIndex === -1 ? 0 : matchIndex);
    const allUrls = citations.length > 0 ? citations : extractUrls(text);
    const citedUrl = findCitedUrl(allUrls, domain);
    const fullResponse = text.length > MAX_FULL_RESPONSE_CHARS ? text.slice(0, MAX_FULL_RESPONSE_CHARS) + "…" : text;
    return { provider, configured: true, mentioned: true, snippet, fullResponse, citedUrl, sentiment, error: null };
  } catch (err) {
    return {
      provider,
      configured: true,
      mentioned: false,
      snippet: null,
      fullResponse: null,
      citedUrl: null,
      sentiment: null,
      error: err instanceof Error ? err.message : "Request failed.",
    };
  }
}

export async function runAiVisibilityCheck(
  domain: string,
  prompts: string[],
  apiKeys: ApiKeys
): Promise<AiVisibilityResult> {
  const brand = brandFromDomain(domain);
  const trimmedPrompts = prompts.map((p) => p.trim()).filter(Boolean).slice(0, MAX_PROMPTS);

  const providers: AiProvider[] = ["openai", "anthropic", "gemini", "perplexity"];
  const keyFor: Record<AiProvider, string | undefined> = {
    openai: apiKeys.openai,
    anthropic: apiKeys.anthropic,
    gemini: apiKeys.gemini,
    perplexity: apiKeys.perplexity,
  };

  const promptResults: PromptResult[] = await Promise.all(
    trimmedPrompts.map(async (prompt) => {
      const results = await Promise.all(
        providers.map((provider) => runProvider(provider, prompt, keyFor[provider], domain, brand))
      );
      return { prompt, results };
    })
  );

  const mentionRates: ProviderMentionRate[] = providers.map((provider) => {
    const relevant = promptResults.flatMap((p) => p.results.filter((r) => r.provider === provider && r.configured));
    return {
      provider,
      mentionedCount: relevant.filter((r) => r.mentioned).length,
      queriedCount: relevant.length,
    };
  });

  return { domain, brand, promptResults, mentionRates };
}
