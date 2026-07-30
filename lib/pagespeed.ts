/**
 * Client for Google's PageSpeed Insights (PSI) v5 API — a free, public API that
 * runs a real Lighthouse audit against any public URL and returns Performance,
 * Accessibility, Best Practices, and SEO scores (0-100), plus Core Web Vitals,
 * specific fix-it opportunities, and failed accessibility/SEO/best-practices
 * checks. Docs: https://developers.google.com/speed/docs/insights/v5/reference/pagespeedapi/runpagespeed
 *
 * PSI does the actual fetching of the target site on Google's end, not ours —
 * so this has no SSRF exposure the way lib/fetch-site.ts does. It IS slow
 * (Lighthouse audits commonly take 10-30s, sometimes more), so callers should
 * treat this as a distinct, opt-in "diagnose performance" action rather than
 * bundling it into the fast tech-stack scan.
 *
 * We deliberately don't return the raw PSI response to callers — it's often
 * several hundred KB (full per-audit detail, network request logs, etc.).
 * Everything below extracts just the handful of fields worth showing.
 */

export type PsiStrategy = "mobile" | "desktop";

export interface PsiScores {
  performance: number | null;
  accessibility: number | null;
  bestPractices: number | null;
  seo: number | null;
}

export type VitalRating = "good" | "needs-improvement" | "poor";

export interface WebVital {
  label: string; // "LCP" | "CLS" | "INP" | "TBT"
  value: string; // formatted for display, e.g. "2.4 s" or "0.08"
  rating: VitalRating;
}

export interface WebVitals {
  /** "field" = real Chrome user data (CrUX) for this page/origin — only
   *  available once Google has collected enough real-world traffic for it.
   *  "lab" = simulated data from this Lighthouse run, always available. */
  source: "field" | "lab";
  metrics: WebVital[];
}

export interface AuditIssue {
  id: string;
  title: string;
  description: string;
}

export interface Opportunity extends AuditIssue {
  savingsMs: number;
  displaySavings: string;
}

export interface PsiDetail {
  webVitals: WebVitals | null;
  opportunities: Opportunity[];
  failedAudits: {
    accessibility: AuditIssue[];
    seo: AuditIssue[];
    bestPractices: AuditIssue[];
  };
}

export interface PsiResult {
  strategy: PsiStrategy;
  scores: PsiScores | null;
  detail: PsiDetail | null;
  error: string | null;
}

const TIMEOUT_MS = 45_000; // Lighthouse audits are slow — leave real headroom
const API_URL = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

function scoreOf(categories: any, key: string): number | null {
  const raw = categories?.[key]?.score;
  return typeof raw === "number" ? Math.round(raw * 100) : null;
}

function stripMarkdownLinks(text: string | undefined): string {
  if (!text) return "";
  // Lighthouse audit descriptions use "[link text](url)" — not rendering
  // markdown here, so collapse those down to plain readable text.
  return text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\s+/g, " ").trim();
}

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

function rate(value: number, good: number, poor: number): VitalRating {
  if (value <= good) return "good";
  if (value <= poor) return "needs-improvement";
  return "poor";
}

// Official Core Web Vitals thresholds (Google's published "good" / "poor"
// boundaries — "needs improvement" is anything in between).
const THRESHOLDS = {
  lcp: { good: 2500, poor: 4000 }, // ms
  cls: { good: 0.1, poor: 0.25 }, // unitless
  inp: { good: 200, poor: 500 }, // ms
  tbt: { good: 200, poor: 600 }, // ms — lab-only proxy for responsiveness (no lab equivalent of INP)
};

function extractWebVitals(data: any): WebVitals | null {
  const field = data?.loadingExperience?.metrics;
  if (field?.LARGEST_CONTENTFUL_PAINT_MS || field?.CUMULATIVE_LAYOUT_SHIFT_SCORE || field?.INTERACTION_TO_NEXT_PAINT) {
    const metrics: WebVital[] = [];

    const lcp = field.LARGEST_CONTENTFUL_PAINT_MS?.percentile;
    if (typeof lcp === "number") {
      metrics.push({ label: "LCP", value: formatMs(lcp), rating: rate(lcp, THRESHOLDS.lcp.good, THRESHOLDS.lcp.poor) });
    }

    // CrUX reports this field as an integer (score * 100) to keep it bucket-
    // friendly; divide back down to the standard 0-1ish CLS scale.
    const cls = field.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile;
    if (typeof cls === "number") {
      const clsValue = cls / 100;
      metrics.push({ label: "CLS", value: clsValue.toFixed(2), rating: rate(clsValue, THRESHOLDS.cls.good, THRESHOLDS.cls.poor) });
    }

    const inp = field.INTERACTION_TO_NEXT_PAINT?.percentile;
    if (typeof inp === "number") {
      metrics.push({ label: "INP", value: formatMs(inp), rating: rate(inp, THRESHOLDS.inp.good, THRESHOLDS.inp.poor) });
    }

    if (metrics.length > 0) return { source: "field", metrics };
  }

  // No field data (common for lower-traffic pages/origins — Google only
  // publishes CrUX data once it has enough real-world samples). Fall back to
  // this run's own lab measurements, which are always present.
  const audits = data?.lighthouseResult?.audits;
  if (!audits) return null;

  const metrics: WebVital[] = [];
  const lcpAudit = audits["largest-contentful-paint"]?.numericValue;
  if (typeof lcpAudit === "number") {
    metrics.push({ label: "LCP", value: formatMs(lcpAudit), rating: rate(lcpAudit, THRESHOLDS.lcp.good, THRESHOLDS.lcp.poor) });
  }
  const clsAudit = audits["cumulative-layout-shift"]?.numericValue;
  if (typeof clsAudit === "number") {
    metrics.push({ label: "CLS", value: clsAudit.toFixed(2), rating: rate(clsAudit, THRESHOLDS.cls.good, THRESHOLDS.cls.poor) });
  }
  const tbtAudit = audits["total-blocking-time"]?.numericValue;
  if (typeof tbtAudit === "number") {
    metrics.push({ label: "TBT", value: formatMs(tbtAudit), rating: rate(tbtAudit, THRESHOLDS.tbt.good, THRESHOLDS.tbt.poor) });
  }

  return metrics.length > 0 ? { source: "lab", metrics } : null;
}

/** Top performance "opportunities" (specific fixes Lighthouse estimates savings for), sorted by savings, capped at 3. */
function extractOpportunities(data: any): Opportunity[] {
  const audits = data?.lighthouseResult?.audits;
  if (!audits) return [];

  const opportunities: Opportunity[] = [];
  for (const id of Object.keys(audits)) {
    const audit = audits[id];
    const savingsMs = audit?.details?.type === "opportunity" ? audit.details.overallSavingsMs : undefined;
    if (typeof savingsMs === "number" && savingsMs > 0) {
      opportunities.push({
        id,
        title: audit.title ?? id,
        description: stripMarkdownLinks(audit.description),
        savingsMs,
        displaySavings: `saves ~${formatMs(savingsMs)}`,
      });
    }
  }

  opportunities.sort((a, b) => b.savingsMs - a.savingsMs);
  return opportunities.slice(0, 3);
}

/** Failed (score < 1) binary-pass/fail audits for one category, ordered by how much weight they carry in the category score, capped. */
function extractFailedAudits(data: any, categoryKey: string, limit = 5): AuditIssue[] {
  const category = data?.lighthouseResult?.categories?.[categoryKey];
  const audits = data?.lighthouseResult?.audits;
  if (!category?.auditRefs || !audits) return [];

  const failed: (AuditIssue & { weight: number })[] = [];
  for (const ref of category.auditRefs) {
    const audit = audits[ref.id];
    if (!audit) continue;
    // Only binary pass/fail audits — numeric/metric audits (like "speed-index")
    // and manual/informative ones shouldn't be listed as "failed checks".
    if (audit.scoreDisplayMode !== "binary") continue;
    if (audit.score === 1 || audit.score === null) continue;
    failed.push({
      id: ref.id,
      title: audit.title ?? ref.id,
      description: stripMarkdownLinks(audit.description),
      weight: typeof ref.weight === "number" ? ref.weight : 0,
    });
  }

  failed.sort((a, b) => b.weight - a.weight);
  return failed.slice(0, limit).map(({ weight, ...rest }) => rest);
}

/**
 * Runs a single PSI audit for one strategy (mobile or desktop). Never throws —
 * failures (timeout, quota, invalid target) come back as { error } so the
 * caller can show mobile and desktop independently even if one side fails.
 */
export async function runPageSpeed(url: string, strategy: PsiStrategy, apiKey: string | undefined): Promise<PsiResult> {
  const params = new URLSearchParams({ url, strategy });
  params.append("category", "performance");
  params.append("category", "accessibility");
  params.append("category", "best-practices");
  params.append("category", "seo");
  if (apiKey) params.set("key", apiKey);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${API_URL}?${params.toString()}`, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) {
      let message = `PageSpeed API returned HTTP ${res.status}.`;
      try {
        const body = await res.json();
        if (body?.error?.message) message = body.error.message;
      } catch {
        // ignore — use the generic message above
      }
      // Google's quota-exceeded errors are the most common failure mode once
      // this gets real traffic; surface a clearer hint for that specific case.
      if (res.status === 429) {
        message = "PageSpeed API quota exceeded for today. Add GOOGLE_PAGESPEED_API_KEY for a much higher quota, or try again later.";
      }
      return { strategy, scores: null, detail: null, error: message };
    }

    const data = await res.json();
    const categories = data?.lighthouseResult?.categories;
    if (!categories) {
      return { strategy, scores: null, detail: null, error: "PageSpeed API returned an unexpected response shape." };
    }

    return {
      strategy,
      scores: {
        performance: scoreOf(categories, "performance"),
        accessibility: scoreOf(categories, "accessibility"),
        bestPractices: scoreOf(categories, "best-practices"),
        seo: scoreOf(categories, "seo"),
      },
      detail: {
        webVitals: extractWebVitals(data),
        opportunities: extractOpportunities(data),
        failedAudits: {
          accessibility: extractFailedAudits(data, "accessibility"),
          seo: extractFailedAudits(data, "seo"),
          bestPractices: extractFailedAudits(data, "best-practices"),
        },
      },
      error: null,
    };
  } catch (err) {
    clearTimeout(timer);
    if (controller.signal.aborted) {
      return { strategy, scores: null, detail: null, error: "PageSpeed audit timed out." };
    }
    return { strategy, scores: null, detail: null, error: "Couldn't reach the PageSpeed API." };
  }
}

/** Runs mobile and desktop audits in parallel so total latency is ~one audit, not two. */
export async function runPageSpeedBoth(url: string, apiKey: string | undefined): Promise<{ mobile: PsiResult; desktop: PsiResult }> {
  const [mobile, desktop] = await Promise.all([
    runPageSpeed(url, "mobile", apiKey),
    runPageSpeed(url, "desktop", apiKey),
  ]);
  return { mobile, desktop };
}
