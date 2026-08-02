// SEO rank/keyword checker built on Serper.dev's Google SERP API. This is an
// on-demand single check, not a historical rank tracker (no database yet) —
// it answers "where does this domain rank for this keyword right now", plus
// surfaces the top organic competitors and related-search/People Also Ask
// terms as lightweight keyword-research ideas.
//
// Out of scope for this pass: backlink data and a full technical site audit.
// Serper is a SERP scraper, not a link index — backlinks need a separate
// vendor (e.g. Majestic's self-serve API). Site audit is partially covered
// already by the existing PageSpeed Insights SEO category and our own
// title/meta/H1 extraction; a deeper crawl-based audit is a follow-up.

const TIMEOUT_MS = 15_000;
const MAX_RESULTS_CHECKED = 100; // Serper can return up to 100 organic results per query.

export interface OrganicResult {
  position: number;
  title: string;
  link: string;
  snippet: string | null;
}

export interface KnowledgeGraphResult {
  title: string | null;
  type: string | null;
  website: string | null;
  description: string | null;
  imageUrl: string | null;
  attributes: Record<string, string> | null;
}

export interface AnswerBoxResult {
  title: string | null;
  answer: string | null;
  link: string | null;
}

export interface AiOverviewSource {
  title: string | null;
  link: string | null;
}

export interface AiOverviewResult {
  text: string | null;
  sources: AiOverviewSource[];
  domainCited: boolean; // true if the scanned domain appears among the AI Overview's cited sources
}

export interface SeoRankResult {
  keyword: string;
  domain: string;
  rank: number | null; // null = not found in the results Serper returned
  matchedUrl: string | null;
  topResults: OrganicResult[];
  relatedSearches: string[];
  peopleAlsoAsk: string[];
  knowledgeGraph: KnowledgeGraphResult | null;
  answerBox: AnswerBoxResult | null;
  aiOverview: AiOverviewResult | null;
}

export class SerperError extends Error {
  readonly isSerperError = true as const;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

// Serper's optional SERP-feature fields. Not every query returns these, and
// the exact shape can drift slightly between Serper API versions, so parsing
// here is defensive: unknown/missing sub-fields fall back to null rather than
// throwing, and a few plausible key-name variants are checked.
function parseKnowledgeGraph(kg: any): KnowledgeGraphResult | null {
  if (!kg || typeof kg !== "object") return null;
  const title = kg.title ?? null;
  if (!title) return null;
  return {
    title,
    type: kg.type ?? null,
    website: kg.website ?? kg.url ?? null,
    description: kg.description ?? null,
    imageUrl: kg.imageUrl ?? kg.image ?? null,
    attributes: kg.attributes && typeof kg.attributes === "object" ? kg.attributes : null,
  };
}

function parseAnswerBox(ab: any): AnswerBoxResult | null {
  if (!ab || typeof ab !== "object") return null;
  const answer: string | null = ab.answer ?? ab.snippet ?? null;
  const title: string | null = ab.title ?? null;
  if (!answer && !title) return null;
  return {
    title,
    answer,
    link: ab.link ?? null,
  };
}

function parseAiOverview(ai: any, domain: string): AiOverviewResult | null {
  if (!ai || typeof ai !== "object") return null;
  const text: string | null = ai.text ?? ai.content ?? ai.answer ?? null;
  const rawSources: any[] = Array.isArray(ai.sources)
    ? ai.sources
    : Array.isArray(ai.references)
      ? ai.references
      : [];
  const sources: AiOverviewSource[] = rawSources
    .map((s: any): AiOverviewSource => {
      if (typeof s === "string") return { title: null, link: s };
      return { title: s?.title ?? null, link: s?.link ?? s?.url ?? null };
    })
    .filter((s: AiOverviewSource): boolean => Boolean(s.link));

  if (!text && sources.length === 0) return null;

  const targetHost = domain.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].toLowerCase();
  const domainCited = sources.some((s) => s.link && hostnameOf(s.link).includes(targetHost));

  return { text, sources, domainCited };
}

export async function checkSeoRank(keyword: string, domain: string, apiKey: string): Promise<SeoRankResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      signal: controller.signal,
      headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ q: keyword, num: MAX_RESULTS_CHECKED }),
    });
  } catch (err) {
    clearTimeout(timer);
    if (controller.signal.aborted) throw new SerperError("The rank check took too long to respond.");
    throw new SerperError("Couldn't reach Serper — check the SERPER_API_KEY is set correctly.");
  }
  clearTimeout(timer);

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new SerperError("Serper API key is missing or invalid.");
    }
    if (response.status === 429) {
      throw new SerperError("Serper rate limit or credit balance exceeded.");
    }
    throw new SerperError(`Serper API error (${response.status}).`);
  }

  const data = await response.json();
  const organic: any[] = Array.isArray(data.organic) ? data.organic : [];
  const targetHost = domain.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].toLowerCase();

  const topResults: OrganicResult[] = organic.slice(0, 10).map((r) => ({
    position: r.position,
    title: r.title ?? "",
    link: r.link ?? "",
    snippet: r.snippet ?? null,
  }));

  const matched = organic.find((r) => hostnameOf(r.link ?? "").includes(targetHost));

  const relatedSearches: string[] = Array.isArray(data.relatedSearches)
    ? data.relatedSearches.map((r: any) => r.query).filter(Boolean)
    : [];
  const peopleAlsoAsk: string[] = Array.isArray(data.peopleAlsoAsk)
    ? data.peopleAlsoAsk.map((r: any) => r.question).filter(Boolean)
    : [];

  const knowledgeGraph = parseKnowledgeGraph(data.knowledgeGraph);
  const answerBox = parseAnswerBox(data.answerBox);
  const aiOverview = parseAiOverview(data.aiOverview, domain);

  return {
    keyword,
    domain,
    rank: matched ? matched.position : null,
    matchedUrl: matched ? matched.link : null,
    topResults,
    relatedSearches,
    peopleAlsoAsk,
    knowledgeGraph,
    answerBox,
    aiOverview,
  };
}
