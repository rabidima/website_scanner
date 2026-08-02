"use client";

import { useState } from "react";
import type { Category, Technology } from "@/lib/detect";

interface PageInfo {
  title: string | null;
  description: string | null;
  h1: string | null;
}

interface LlmsTxt {
  found: boolean;
  url: string;
  content: string | null;
  truncated: boolean;
}

interface BotBlock {
  blocked: boolean;
  vendor: string | null;
}

interface ScanResponse {
  requestedUrl: string;
  finalUrl: string;
  statusCode: number;
  scannedAt: string;
  technologies: Technology[];
  page: PageInfo;
  llmsTxt: LlmsTxt;
  botBlock: BotBlock;
  meta: { server: string | null; poweredBy: string | null };
}

interface PsiScores {
  performance: number | null;
  accessibility: number | null;
  bestPractices: number | null;
  seo: number | null;
}

type VitalRating = "good" | "needs-improvement" | "poor";

interface WebVital {
  label: string;
  value: string;
  rating: VitalRating;
}

interface WebVitals {
  source: "field" | "lab";
  metrics: WebVital[];
}

interface AuditIssue {
  id: string;
  title: string;
  description: string;
}

interface Opportunity extends AuditIssue {
  savingsMs: number;
  displaySavings: string;
}

interface PsiDetail {
  webVitals: WebVitals | null;
  opportunities: Opportunity[];
  failedAudits: {
    accessibility: AuditIssue[];
    seo: AuditIssue[];
    bestPractices: AuditIssue[];
  };
}

interface PsiResult {
  strategy: "mobile" | "desktop";
  scores: PsiScores | null;
  detail: PsiDetail | null;
  error: string | null;
}

interface PageSpeedResponse {
  url: string;
  mobile: PsiResult;
  desktop: PsiResult;
}

type AiProvider = "openai" | "anthropic" | "gemini" | "perplexity";

const PROVIDER_LABELS: Record<AiProvider, string> = {
  openai: "ChatGPT",
  anthropic: "Claude",
  gemini: "Gemini",
  perplexity: "Perplexity",
};

interface AiProviderResult {
  provider: AiProvider;
  configured: boolean;
  mentioned: boolean;
  snippet: string | null;
  citedUrl: string | null;
  sentiment: "positive" | "neutral" | "negative" | null;
  error: string | null;
}

interface AiPromptResult {
  prompt: string;
  results: AiProviderResult[];
}

interface AiMentionRate {
  provider: AiProvider;
  mentionedCount: number;
  queriedCount: number;
}

interface AiVisibilityResponse {
  domain: string;
  brand: string;
  promptResults: AiPromptResult[];
  mentionRates: AiMentionRate[];
}

interface OrganicResult {
  position: number;
  title: string;
  link: string;
  snippet: string | null;
}

interface KnowledgeGraphResult {
  title: string | null;
  type: string | null;
  website: string | null;
  description: string | null;
  imageUrl: string | null;
  attributes: Record<string, string> | null;
}

interface AnswerBoxResult {
  title: string | null;
  answer: string | null;
  link: string | null;
}

interface AiOverviewSource {
  title: string | null;
  link: string | null;
}

interface AiOverviewResult {
  text: string | null;
  sources: AiOverviewSource[];
  domainCited: boolean;
}

interface SeoRankResponse {
  keyword: string;
  domain: string;
  rank: number | null;
  matchedUrl: string | null;
  topResults: OrganicResult[];
  relatedSearches: string[];
  peopleAlsoAsk: string[];
  knowledgeGraph: KnowledgeGraphResult | null;
  answerBox: AnswerBoxResult | null;
  aiOverview: AiOverviewResult | null;
}

function ratingColor(rating: VitalRating): string {
  if (rating === "good") return "#3ecf8e";
  if (rating === "needs-improvement") return "#e8b64a";
  return "#ff6b6b";
}

function VitalPill({ vital }: { vital: WebVital }) {
  const color = ratingColor(vital.rating);
  return (
    <div className="vital-pill" style={{ borderColor: color }}>
      <span className="vital-label">{vital.label}</span>
      <span className="vital-value" style={{ color }}>{vital.value}</span>
    </div>
  );
}

function gaugeColor(score: number): string {
  if (score >= 90) return "#3ecf8e";
  if (score >= 50) return "#e8b64a";
  return "#ff6b6b";
}

function Gauge({ label, score }: { label: string; score: number | null }) {
  const r = 40;
  const circumference = 2 * Math.PI * r;
  const pct = score ?? 0;
  const offset = circumference - (pct / 100) * circumference;
  const color = score === null ? "#5f5e5a" : gaugeColor(score);

  return (
    <div className="gauge">
      <svg viewBox="0 0 100 100" width="88" height="88">
        <circle cx="50" cy="50" r={r} fill="none" stroke="#232733" strokeWidth="8" />
        {score !== null && (
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform="rotate(-90 50 50)"
          />
        )}
        <text x="50" y="56" textAnchor="middle" fontSize="26" fontWeight="600" fill={color}>
          {score ?? "—"}
        </text>
      </svg>
      <div className="gauge-label">{label}</div>
    </div>
  );
}

function AuditList({ title, items }: { title: string; items: AuditIssue[] }) {
  if (items.length === 0) return null;
  return (
    <div className="audit-group">
      <div className="audit-group-title">{title}</div>
      <ul className="audit-list">
        {items.map((a) => (
          <li key={a.id} title={a.description}>{a.title}</li>
        ))}
      </ul>
    </div>
  );
}

function ProviderChip({ result }: { result: AiProviderResult }) {
  if (!result.configured) {
    return (
      <div className="ai-provider-chip not-configured">
        {PROVIDER_LABELS[result.provider]}
        <span className="ai-chip-status">not configured</span>
      </div>
    );
  }
  if (result.error) {
    return (
      <div className="ai-provider-chip errored" title={result.error}>
        {PROVIDER_LABELS[result.provider]}
        <span className="ai-chip-status">error</span>
      </div>
    );
  }
  if (!result.mentioned) {
    return (
      <div className="ai-provider-chip not-mentioned">
        {PROVIDER_LABELS[result.provider]}
        <span className="ai-chip-status">not mentioned</span>
      </div>
    );
  }
  const sentimentClass = result.sentiment ?? "neutral";
  return (
    <div className={`ai-provider-chip mentioned ${sentimentClass}`} title={result.snippet ?? ""}>
      {PROVIDER_LABELS[result.provider]}
      <span className="ai-chip-status">mentioned{result.sentiment ? ` · ${result.sentiment}` : ""}</span>
      {result.citedUrl && (
        <a href={result.citedUrl} target="_blank" rel="noopener noreferrer" className="ai-chip-cite" onClick={(e) => e.stopPropagation()}>
          cited
        </a>
      )}
    </div>
  );
}

function LlmsTxtCard({ llmsTxt }: { llmsTxt: LlmsTxt }) {
  const [expanded, setExpanded] = useState(true);

  if (!llmsTxt.found) {
    return (
      <div className="llms-txt-card">
        <div className="llms-txt-header">
          <h2>llms.txt</h2>
        </div>
        <p className="llms-txt-empty">No llms.txt found at the domain root.</p>
      </div>
    );
  }

  return (
    <div className="llms-txt-card">
      <div className="llms-txt-header">
        <h2>llms.txt</h2>
        <div className="llms-txt-actions">
          <a href={llmsTxt.url} target="_blank" rel="noopener noreferrer">View raw</a>
          <button type="button" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Collapse" : "Expand"}
          </button>
        </div>
      </div>
      {llmsTxt.truncated && (
        <p className="llms-txt-truncated">Showing the first 20,000 characters — the file is longer than that.</p>
      )}
      {expanded && <pre className="llms-txt-content">{llmsTxt.content}</pre>}
    </div>
  );
}

function StrategyRow({ label, result }: { label: string; result: PsiResult }) {
  const d = result.detail;
  return (
    <div className="psi-strategy">
      <div className="psi-strategy-label">{label}</div>
      {result.error ? (
        <div className="psi-strategy-error">{result.error}</div>
      ) : (
        <>
          <div className="gauge-row">
            <Gauge label="Performance" score={result.scores?.performance ?? null} />
            <Gauge label="Accessibility" score={result.scores?.accessibility ?? null} />
            <Gauge label="Best Practices" score={result.scores?.bestPractices ?? null} />
            <Gauge label="SEO" score={result.scores?.seo ?? null} />
          </div>

          {d?.webVitals && d.webVitals.metrics.length > 0 && (
            <div className="vitals-block">
              <div className="vitals-heading">
                Core Web Vitals <span className="vitals-source">({d.webVitals.source === "field" ? "real user data" : "lab estimate"})</span>
              </div>
              <div className="vitals-row">
                {d.webVitals.metrics.map((v) => (
                  <VitalPill key={v.label} vital={v} />
                ))}
              </div>
            </div>
          )}

          {d && d.opportunities.length > 0 && (
            <div className="opportunities-block">
              <div className="audit-group-title">Top opportunities</div>
              <ul className="opportunity-list">
                {d.opportunities.map((o) => (
                  <li key={o.id} title={o.description}>
                    <span className="opportunity-title">{o.title}</span>
                    <span className="opportunity-savings">{o.displaySavings}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {d && (
            <div className="audit-groups">
              <AuditList title="Accessibility issues" items={d.failedAudits.accessibility} />
              <AuditList title="SEO issues" items={d.failedAudits.seo} />
              <AuditList title="Best practices issues" items={d.failedAudits.bestPractices} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

const CATEGORY_ORDER: Category[] = [
  "CMS",
  "Ecommerce",
  "Shopify Apps",
  "JS Framework",
  "CSS Framework",
  "Analytics",
  "Tag Manager",
  "CDN / Hosting",
  "Web Server",
  "Payment",
  "Fonts",
  "Chat / Support",
  "Email / Marketing",
];

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResponse | null>(null);

  const [psiLoading, setPsiLoading] = useState(false);
  const [psiError, setPsiError] = useState<string | null>(null);
  const [psiResult, setPsiResult] = useState<PageSpeedResponse | null>(null);

  const [aiPrompts, setAiPrompts] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<AiVisibilityResponse | null>(null);

  const [seoKeyword, setSeoKeyword] = useState("");
  const [seoLoading, setSeoLoading] = useState(false);
  const [seoError, setSeoError] = useState<string | null>(null);
  const [seoResult, setSeoResult] = useState<SeoRankResponse | null>(null);

  async function runScan(targetUrl: string) {
    if (!targetUrl.trim() || loading) return;

    setLoading(true);
    setError(null);
    setResult(null);
    setPsiResult(null);
    setPsiError(null);
    setAiResult(null);
    setAiError(null);
    setSeoResult(null);
    setSeoError(null);

    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: targetUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Scan failed.");
      } else {
        setResult(data);
      }
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleScan(e: React.FormEvent) {
    e.preventDefault();
    await runScan(url);
  }

  async function handlePageSpeed() {
    if (!result || psiLoading) return;
    setPsiLoading(true);
    setPsiError(null);

    try {
      const res = await fetch("/api/pagespeed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: result.finalUrl }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPsiError(data.error ?? "PageSpeed diagnostics failed.");
      } else {
        setPsiResult(data);
      }
    } catch {
      setPsiError("Network error. Try again.");
    } finally {
      setPsiLoading(false);
    }
  }

  async function handleAiVisibility() {
    if (!result || aiLoading) return;
    const prompts = aiPrompts
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean)
      .slice(0, 5);
    if (prompts.length === 0) {
      setAiError("Enter at least one prompt, one per line.");
      return;
    }
    setAiLoading(true);
    setAiError(null);

    try {
      const res = await fetch("/api/ai-visibility", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: result.finalUrl, prompts }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAiError(data.error ?? "AI visibility check failed.");
      } else {
        setAiResult(data);
      }
    } catch {
      setAiError("Network error. Try again.");
    } finally {
      setAiLoading(false);
    }
  }

  async function handleSeoRank() {
    if (!result || seoLoading || !seoKeyword.trim()) return;
    setSeoLoading(true);
    setSeoError(null);

    try {
      const res = await fetch("/api/seo-rank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: result.finalUrl, keyword: seoKeyword.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSeoError(data.error ?? "Rank check failed.");
      } else {
        setSeoResult(data);
      }
    } catch {
      setSeoError("Network error. Try again.");
    } finally {
      setSeoLoading(false);
    }
  }

  const grouped = result
    ? CATEGORY_ORDER.map((cat) => ({
        category: cat,
        items: result.technologies.filter((t) => t.category === cat),
      })).filter((g) => g.items.length > 0)
    : [];

  return (
    <div className="page">
      <div className="hero">
        <h1>What&apos;s that site built with?</h1>
        <p>Paste a URL and get a plain-English read on its visible tech stack — CMS, frameworks, analytics, hosting, and more.</p>
      </div>

      <form className="scan-form" onSubmit={handleScan}>
        <input
          type="text"
          placeholder="example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={loading}
          autoFocus
        />
        <button type="submit" disabled={loading}>
          {loading ? "Scanning…" : "Scan"}
        </button>
      </form>

      {error && (
        <div className="error-banner">
          <div>{error}</div>
          <button type="button" className="retry-btn" onClick={() => runScan(url)}>
            Try re-running the test
          </button>
        </div>
      )}

      {loading && <div className="loading">Fetching the page and checking signatures…</div>}

      {result && (
        <>
          <div className="summary">
            Scanned <code>{result.finalUrl}</code> · HTTP {result.statusCode} ·{" "}
            {result.technologies.length} technolog{result.technologies.length === 1 ? "y" : "ies"} detected
          </div>

          {result.botBlock.blocked && (
            <div className="bot-block-banner">
              This scan was likely blocked by {result.botBlock.vendor ? `${result.botBlock.vendor}'s` : "this site's"} bot
              protection, which returned a block page instead of the real site. The title, description, H1, and any content
              below may reflect that block page rather than {result.finalUrl}&apos;s actual content.
            </div>
          )}

          <div className="page-info-card">
            <div className="page-info-row">
              <span className="page-info-label">Title</span>
              <span className="page-info-value">{result.page.title ?? <em>Not found</em>}</span>
            </div>
            <div className="page-info-row">
              <span className="page-info-label">Description</span>
              <span className="page-info-value">{result.page.description ?? <em>Not found</em>}</span>
            </div>
            <div className="page-info-row">
              <span className="page-info-label">H1</span>
              <span className="page-info-value">{result.page.h1 ?? <em>Not found</em>}</span>
            </div>
          </div>

          <LlmsTxtCard llmsTxt={result.llmsTxt} />

          <div className="results">
            {grouped.length === 0 && (
              <div className="empty-state">
                No signatures matched. The site may be minified, behind heavy obfuscation, or use tech outside our current signature set.
              </div>
            )}
            {grouped.map((g) => (
              <div className="category-card" key={g.category}>
                <h2>{g.category}</h2>
                <div className="tech-list">
                  {g.items.map((t) => (
                    <div className={`tech-chip ${t.confidence}`} key={t.name} title={t.evidence.join(", ")}>
                      <span className="dot" />
                      <span className="name">{t.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="psi-section">
            <div className="psi-header">
              <h2>Diagnose performance issues</h2>
              <button type="button" onClick={handlePageSpeed} disabled={psiLoading}>
                {psiLoading && <span className="spinner spinner-inline" aria-hidden="true" />}
                {psiLoading ? "Running…" : psiResult ? "Re-run" : "Run diagnostics"}
              </button>
            </div>
            <p className="psi-subtext">
              Runs a Google PageSpeed Insights (Lighthouse Audit). Takes 10-30 seconds.
            </p>

            {psiLoading && (
              <div className="loading">
                <span className="spinner" aria-hidden="true" />
                Running Lighthouse audits for mobile and desktop…
              </div>
            )}
            {psiError && (
              <div className="error-banner">
                <div>{psiError}</div>
                <button type="button" className="retry-btn" onClick={handlePageSpeed}>
                  Try re-running the test
                </button>
              </div>
            )}

            {psiResult && (
              <div className="psi-results">
                <StrategyRow label="Mobile" result={psiResult.mobile} />
                <StrategyRow label="Desktop" result={psiResult.desktop} />
              </div>
            )}
          </div>

          <div className="psi-section">
            <div className="psi-header">
              <h2>AI visibility check</h2>
              <button type="button" onClick={handleAiVisibility} disabled={aiLoading}>
                {aiLoading && <span className="spinner spinner-inline" aria-hidden="true" />}
                {aiLoading ? "Checking…" : aiResult ? "Re-run" : "Check AI visibility"}
              </button>
            </div>
            <p className="psi-subtext">
              Queries ChatGPT, Claude, Gemini, and Perplexity directly with prompts you choose, and checks whether{" "}
              {result.finalUrl} gets mentioned. Live snapshot only — not tracked over time. Up to 5 prompts, one per line.
            </p>
            <textarea
              className="ai-prompts-input"
              placeholder={"best alternatives to ...\nwho are the top companies for ...\nis ... worth it?"}
              value={aiPrompts}
              onChange={(e) => setAiPrompts(e.target.value)}
              disabled={aiLoading}
              rows={4}
            />

            {aiLoading && (
              <div className="loading">
                <span className="spinner" aria-hidden="true" />
                Querying AI providers…
              </div>
            )}
            {aiError && (
              <div className="error-banner">
                <div>{aiError}</div>
                <button type="button" className="retry-btn" onClick={handleAiVisibility}>
                  Try re-running the test
                </button>
              </div>
            )}

            {aiResult && (
              <div className="ai-results">
                <div className="ai-mention-rates">
                  {aiResult.mentionRates.map((r) => (
                    <div className="ai-rate-pill" key={r.provider}>
                      <span className="ai-rate-label">{PROVIDER_LABELS[r.provider]}</span>
                      <span className="ai-rate-value">
                        {r.queriedCount === 0 ? "not configured" : `${r.mentionedCount}/${r.queriedCount} mentioned`}
                      </span>
                    </div>
                  ))}
                </div>
                {aiResult.promptResults.map((pr, i) => (
                  <div className="ai-prompt-result" key={i}>
                    <div className="ai-prompt-text">{pr.prompt}</div>
                    <div className="ai-chip-row">
                      {pr.results.map((r) => (
                        <ProviderChip key={r.provider} result={r} />
                      ))}
                    </div>
                    {pr.results.some((r) => r.error) && (
                      <div className="ai-error-details">
                        {pr.results
                          .filter((r) => r.error)
                          .map((r) => (
                            <div className="ai-error-detail-line" key={r.provider}>
                              <strong>{PROVIDER_LABELS[r.provider]}:</strong> {r.error}
                            </div>
                          ))}
                      </div>
                    )}
                    {pr.results.some((r) => r.mentioned && r.snippet) && (
                      <div className="ai-mention-details">
                        {pr.results
                          .filter((r) => r.mentioned && r.snippet)
                          .map((r) => (
                            <div className="ai-mention-detail-line" key={r.provider}>
                              <strong>{PROVIDER_LABELS[r.provider]}:</strong> {r.snippet}
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="psi-section">
            <div className="psi-header">
              <h2>SEO rank check</h2>
            </div>
            <p className="psi-subtext">
              Checks where {result.finalUrl} currently ranks in Google for a keyword, plus top organic competitors and
              related keyword ideas. Live snapshot, not tracked over time.
            </p>
            <form
              className="scan-form"
              onSubmit={(e) => {
                e.preventDefault();
                handleSeoRank();
              }}
            >
              <input
                type="text"
                placeholder="e.g. handmade candles"
                value={seoKeyword}
                onChange={(e) => setSeoKeyword(e.target.value)}
                disabled={seoLoading}
              />
              <button type="submit" disabled={seoLoading}>
                {seoLoading && <span className="spinner spinner-inline" aria-hidden="true" />}
                {seoLoading ? "Checking…" : "Check rank"}
              </button>
            </form>

            {seoLoading && (
              <div className="loading">
                <span className="spinner" aria-hidden="true" />
                Checking Google search results…
              </div>
            )}
            {seoError && (
              <div className="error-banner">
                <div>{seoError}</div>
                <button type="button" className="retry-btn" onClick={handleSeoRank}>
                  Try re-running the test
                </button>
              </div>
            )}

            {seoResult && (
              <div className="seo-results">
                <div className="seo-rank-badge">
                  {seoResult.rank ? (
                    <>
                      Ranked <strong>#{seoResult.rank}</strong> for &quot;{seoResult.keyword}&quot;
                    </>
                  ) : (
                    <>Not found in the top 100 results for &quot;{seoResult.keyword}&quot;</>
                  )}
                </div>

                {seoResult.knowledgeGraph && (
                  <div className="seo-kg-card">
                    {seoResult.knowledgeGraph.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={seoResult.knowledgeGraph.imageUrl} alt="" className="seo-kg-image" />
                    )}
                    <div className="seo-kg-body">
                      <div className="seo-kg-title">{seoResult.knowledgeGraph.title}</div>
                      {seoResult.knowledgeGraph.type && (
                        <div className="seo-kg-type">{seoResult.knowledgeGraph.type}</div>
                      )}
                      {seoResult.knowledgeGraph.description && (
                        <p className="seo-kg-desc">{seoResult.knowledgeGraph.description}</p>
                      )}
                      {seoResult.knowledgeGraph.website && (
                        <a
                          href={seoResult.knowledgeGraph.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="seo-kg-website"
                        >
                          {seoResult.knowledgeGraph.website}
                        </a>
                      )}
                      {seoResult.knowledgeGraph.attributes && (
                        <div className="seo-kg-attrs">
                          {Object.entries(seoResult.knowledgeGraph.attributes).map(([k, v]) => (
                            <span className="seo-kg-attr" key={k}>
                              <strong>{k}:</strong> {v}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {seoResult.answerBox && (
                  <div className="seo-answerbox">
                    <div className="audit-group-title">Featured snippet (Answer Box)</div>
                    {seoResult.answerBox.title && (
                      <div className="seo-answerbox-title">{seoResult.answerBox.title}</div>
                    )}
                    {seoResult.answerBox.answer && (
                      <p className="seo-answerbox-text">{seoResult.answerBox.answer}</p>
                    )}
                    {seoResult.answerBox.link && (
                      <a href={seoResult.answerBox.link} target="_blank" rel="noopener noreferrer">
                        {seoResult.answerBox.link}
                      </a>
                    )}
                  </div>
                )}

                {seoResult.aiOverview && (
                  <div className="seo-ai-overview">
                    <div className="audit-group-title">
                      Google AI Overview
                      <span
                        className={`seo-ai-cited-badge ${
                          seoResult.aiOverview.domainCited ? "cited" : "not-cited"
                        }`}
                      >
                        {seoResult.aiOverview.domainCited ? "Your domain is cited" : "Not cited"}
                      </span>
                    </div>
                    {seoResult.aiOverview.text && (
                      <p className="seo-ai-overview-text">{seoResult.aiOverview.text}</p>
                    )}
                    {seoResult.aiOverview.sources.length > 0 && (
                      <div className="seo-ai-overview-sources">
                        {seoResult.aiOverview.sources.map((s, i) => (
                          <a
                            key={i}
                            href={s.link ?? "#"}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="seo-ai-source-chip"
                          >
                            {s.title || s.link}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {seoResult.topResults.length > 0 && (
                  <div className="seo-organic-block">
                    <div className="audit-group-title">Top organic results</div>
                    <ol className="seo-organic-list">
                      {seoResult.topResults.map((r) => (
                        <li key={r.position} className={r.link === seoResult.matchedUrl ? "seo-matched" : ""}>
                          <a href={r.link} target="_blank" rel="noopener noreferrer">
                            {r.title || r.link}
                          </a>
                          <span className="seo-organic-url">{r.link}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                {(seoResult.relatedSearches.length > 0 || seoResult.peopleAlsoAsk.length > 0) && (
                  <div className="seo-keyword-ideas">
                    <div className="audit-group-title">Keyword ideas</div>
                    <div className="seo-chip-row">
                      {[...seoResult.relatedSearches, ...seoResult.peopleAlsoAsk].slice(0, 12).map((q, i) => (
                        <span className="seo-idea-chip" key={i}>
                          {q}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      <footer>StackScan MVP — detects visible tech only, not internal or server-side-only tooling.</footer>
    </div>
  );
}
