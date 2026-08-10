import { NextRequest, NextResponse } from "next/server";
import { runPageSpeed, runPageSpeedBoth } from "@/lib/pagespeed";
import { resolveCorsOrigin, corsHeaders } from "@/lib/cors";
import { checkScanAccess } from "@/lib/gate";

export const runtime = "nodejs";
// Lighthouse audits are slow. Vercel allows up to 60s on Hobby, more on Pro —
// this asks for the max we can get on the free tier. If audits still time out
// for slow sites, that's a Vercel plan ceiling, not something to fix here.
export const maxDuration = 60;

// Separate, lower-traffic rate limit from /api/scan — PSI audits are far more
// expensive (they burn Google API quota and take real wall-clock time), so we
// cap harder. Same in-memory-per-instance caveat as the other route: resets
// on cold start, not a hard guarantee under real load.
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 5;
const hits = new Map<string, number[]>();

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > MAX_REQUESTS_PER_WINDOW;
}

export async function OPTIONS(req: NextRequest) {
  const origin = resolveCorsOrigin(req.headers.get("origin"));
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}

export async function POST(req: NextRequest) {
  const origin = resolveCorsOrigin(req.headers.get("origin"));
  const headers = corsHeaders(origin);
  const json = (body: unknown, status: number, extraHeaders?: Record<string, string>) =>
    NextResponse.json(body, { status, headers: { ...headers, ...extraHeaders } });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (isRateLimited(ip)) {
    return json({ error: "Too many PageSpeed requests from this IP. Try again in a minute." }, 429);
  }

  const access = await checkScanAccess(req, ip);
  if (!access.allowed) {
    return json(
      { error: "gate", message: "You've used your free scan. Enter your email to keep scanning." },
      403
    );
  }

  let body: { url?: string; strategy?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  const rawUrl = (body.url ?? "").trim();
  if (!rawUrl) {
    return json({ error: "Enter a URL to diagnose." }, 400);
  }

  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(rawUrl);
  if (hasScheme && !/^https?:/i.test(rawUrl)) {
    return json({ error: "Only http and https URLs are supported." }, 422);
  }
  const normalizedUrl = hasScheme ? rawUrl : `https://${rawUrl}`;

  // No SSRF concern here the way /api/scan has one — PSI's servers fetch the
  // target, not ours — so no DNS/private-IP check is needed for this route.
  //
  // "strategy" is opt-in and defaults to running both mobile + desktop, which
  // is what app/page.tsx and public/embed.js both consume and render side by
  // side. marketpulse.js is the one caller that only ever displays a single
  // Core Web Vitals result, so it can pass strategy: "mobile" to skip the
  // desktop audit entirely. runPageSpeedBoth fires both requests concurrently,
  // so "both" isn't a strict 2x cost in theory — but Google's PSI API applies
  // per-key quota/concurrency limits, so two simultaneous Lighthouse runs from
  // one key commonly queue against each other in practice. Cutting to a single
  // strategy removes that contention and one full Lighthouse run's worth of
  // work, which is the real source of the speedup here.
  const strategy = body.strategy === "mobile" ? "mobile" : "both";

  if (strategy === "mobile") {
    const mobile = await runPageSpeed(normalizedUrl, "mobile", process.env.GOOGLE_PAGESPEED_API_KEY);
    return json({ url: normalizedUrl, mobile, desktop: null }, 200);
  }

  const { mobile, desktop } = await runPageSpeedBoth(normalizedUrl, process.env.GOOGLE_PAGESPEED_API_KEY);
  return json({ url: normalizedUrl, mobile, desktop }, 200);
}
