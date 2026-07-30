/**
 * Offline test for lib/pagespeed.ts's response parsing. This sandbox can't
 * reach googleapis.com (allowlisted network), so we mock global.fetch with
 * realistic PSI v5 response shapes instead of hitting the real API.
 * Run with: npx tsx scripts/test-pagespeed.mts
 */
import { runPageSpeed, runPageSpeedBoth } from "../lib/pagespeed";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  console.log(`${cond ? "PASS" : "FAIL"} — ${label}${detail ? ` (${detail})` : ""}`);
  if (!cond) failures++;
}

const realFetch = global.fetch;

function mockFetch(handler: (url: string) => Promise<Response>) {
  // @ts-expect-error test-only override
  global.fetch = handler;
}

async function run() {
  // Case 1: successful response with realistic PSI v5 shape.
  mockFetch(async () =>
    new Response(
      JSON.stringify({
        lighthouseResult: {
          categories: {
            performance: { score: 0.61 },
            accessibility: { score: 0.97 },
            "best-practices": { score: 0.96 },
            seo: { score: 0.85 },
          },
        },
      }),
      { status: 200 }
    )
  );
  const ok = await runPageSpeed("https://example.com", "mobile", undefined);
  check("Parses a successful PSI response", ok.error === null && ok.scores !== null);
  check(
    "Scores converted from 0-1 fraction to 0-100 int",
    ok.scores?.performance === 61 && ok.scores?.accessibility === 97 &&
      ok.scores?.bestPractices === 96 && ok.scores?.seo === 85,
    JSON.stringify(ok.scores)
  );

  // Case 2: quota exceeded (429) gets a clear, actionable error message.
  mockFetch(async () => new Response(JSON.stringify({ error: { message: "quota" } }), { status: 429 }));
  const quota = await runPageSpeed("https://example.com", "mobile", undefined);
  check("429 surfaces a quota-specific message", quota.error !== null && quota.error.includes("quota"), quota.error ?? "");

  // Case 3: generic API error (e.g. invalid target) surfaces Google's message.
  mockFetch(async () => new Response(JSON.stringify({ error: { message: "Invalid URL" } }), { status: 400 }));
  const bad = await runPageSpeed("not-a-real-url", "mobile", undefined);
  check("Non-200 surfaces the API's error message", bad.error === "Invalid URL", bad.error ?? "");

  // Case 4: malformed/unexpected response shape doesn't throw.
  mockFetch(async () => new Response(JSON.stringify({ nothing: "useful" }), { status: 200 }));
  const malformed = await runPageSpeed("https://example.com", "mobile", undefined);
  check("Malformed response shape returns an error, not a throw", malformed.error !== null && malformed.scores === null);

  // Case 5: mobile and desktop run in parallel and are independently reported.
  mockFetch(async (url: string) => {
    const strategy = new URL(url).searchParams.get("strategy");
    if (strategy === "mobile") {
      return new Response(
        JSON.stringify({ lighthouseResult: { categories: { performance: { score: 0.5 }, accessibility: { score: 0.9 }, "best-practices": { score: 0.8 }, seo: { score: 0.7 } } } }),
        { status: 200 }
      );
    }
    return new Response(JSON.stringify({ error: { message: "desktop failed" } }), { status: 500 });
  });
  const both = await runPageSpeedBoth("https://example.com", undefined);
  check("Mobile succeeds independently of desktop failing", both.mobile.scores?.performance === 50 && both.desktop.error === "desktop failed");

  // Case 6: field data (real CrUX user data) is preferred over lab data when present.
  mockFetch(async () =>
    new Response(
      JSON.stringify({
        loadingExperience: {
          metrics: {
            LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2100 },
            CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 8 }, // -> 0.08
            INTERACTION_TO_NEXT_PAINT: { percentile: 550 },
          },
        },
        lighthouseResult: {
          categories: {
            performance: { score: 0.7 }, accessibility: { score: 1 },
            "best-practices": { score: 1 }, seo: { score: 1 },
          },
          audits: {},
        },
      }),
      { status: 200 }
    )
  );
  const field = await runPageSpeed("https://example.com", "mobile", undefined);
  check("Web Vitals source is 'field' when CrUX data is present", field.detail?.webVitals?.source === "field");
  check(
    "LCP good, CLS good, INP poor rated correctly from field data",
    field.detail?.webVitals?.metrics.find((m) => m.label === "LCP")?.rating === "good" &&
      field.detail?.webVitals?.metrics.find((m) => m.label === "CLS")?.value === "0.08" &&
      field.detail?.webVitals?.metrics.find((m) => m.label === "INP")?.rating === "poor",
    JSON.stringify(field.detail?.webVitals?.metrics)
  );

  // Case 7: no field data at all -> falls back to lab metrics from this run.
  mockFetch(async () =>
    new Response(
      JSON.stringify({
        lighthouseResult: {
          categories: { performance: { score: 0.7 }, accessibility: { score: 1 }, "best-practices": { score: 1 }, seo: { score: 1 } },
          audits: {
            "largest-contentful-paint": { numericValue: 3000 },
            "cumulative-layout-shift": { numericValue: 0.15 },
            "total-blocking-time": { numericValue: 100 },
          },
        },
      }),
      { status: 200 }
    )
  );
  const lab = await runPageSpeed("https://example.com", "mobile", undefined);
  check("Falls back to 'lab' source when no field data present", lab.detail?.webVitals?.source === "lab");
  check(
    "Lab LCP needs-improvement, TBT good",
    lab.detail?.webVitals?.metrics.find((m) => m.label === "LCP")?.rating === "needs-improvement" &&
      lab.detail?.webVitals?.metrics.find((m) => m.label === "TBT")?.rating === "good",
    JSON.stringify(lab.detail?.webVitals?.metrics)
  );

  // Case 8: opportunities are sorted by savings desc and capped at 3, non-opportunity audits ignored.
  mockFetch(async () =>
    new Response(
      JSON.stringify({
        lighthouseResult: {
          categories: { performance: { score: 0.5 }, accessibility: { score: 1 }, "best-practices": { score: 1 }, seo: { score: 1 } },
          audits: {
            "render-blocking-resources": { title: "Eliminate render-blocking resources", description: "See [docs](https://x.com) for more.", details: { type: "opportunity", overallSavingsMs: 450 } },
            "unused-css": { title: "Reduce unused CSS", details: { type: "opportunity", overallSavingsMs: 900 } },
            "efficient-images": { title: "Efficiently encode images", details: { type: "opportunity", overallSavingsMs: 120 } },
            "uses-text-compression": { title: "Enable text compression", details: { type: "opportunity", overallSavingsMs: 60 } },
            "not-an-opportunity": { title: "Some other audit", details: { type: "table" } },
            "zero-savings": { title: "Technically an opportunity but no real savings", details: { type: "opportunity", overallSavingsMs: 0 } },
          },
        },
      }),
      { status: 200 }
    )
  );
  const opp = await runPageSpeed("https://example.com", "mobile", undefined);
  const oppTitles = opp.detail?.opportunities.map((o) => o.title) ?? [];
  check(
    "Top 3 opportunities sorted by savings desc, capped at 3",
    JSON.stringify(oppTitles) === JSON.stringify(["Reduce unused CSS", "Eliminate render-blocking resources", "Efficiently encode images"]),
    oppTitles.join(", ")
  );
  check(
    "Markdown links stripped from opportunity description",
    opp.detail?.opportunities.find((o) => o.id === "render-blocking-resources")?.description === "See docs for more.",
    opp.detail?.opportunities.find((o) => o.id === "render-blocking-resources")?.description
  );

  // Case 9: failed-audit extraction only includes binary fails, sorted by weight, capped, excludes passed/manual/numeric.
  mockFetch(async () =>
    new Response(
      JSON.stringify({
        lighthouseResult: {
          categories: {
            performance: { score: 1 }, "best-practices": { score: 1 }, seo: { score: 1 },
            accessibility: {
              score: 0.8,
              auditRefs: [
                { id: "color-contrast", weight: 7 },
                { id: "image-alt", weight: 10 },
                { id: "aria-valid", weight: 3 },
                { id: "passed-check", weight: 5 },
                { id: "manual-check", weight: 0 },
                { id: "not-applicable", weight: 0 },
              ],
            },
          },
          audits: {
            "color-contrast": { title: "Contrast issue", scoreDisplayMode: "binary", score: 0 },
            "image-alt": { title: "Missing alt text", scoreDisplayMode: "binary", score: 0 },
            "aria-valid": { title: "Invalid ARIA", scoreDisplayMode: "binary", score: 0 },
            "passed-check": { title: "This one passed", scoreDisplayMode: "binary", score: 1 },
            "manual-check": { title: "Needs manual review", scoreDisplayMode: "manual", score: null },
            "not-applicable": { title: "N/A here", scoreDisplayMode: "notApplicable", score: null },
          },
        },
      }),
      { status: 200 }
    )
  );
  const failed = await runPageSpeed("https://example.com", "mobile", undefined);
  const failedTitles = failed.detail?.failedAudits.accessibility.map((a) => a.title) ?? [];
  check(
    "Only binary-failed audits included, sorted by weight desc",
    JSON.stringify(failedTitles) === JSON.stringify(["Missing alt text", "Contrast issue", "Invalid ARIA"]),
    failedTitles.join(", ")
  );

  global.fetch = realFetch;

  console.log(`\n${failures === 0 ? "All PageSpeed parsing cases passed." : `${failures} case(s) failed.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

run();
