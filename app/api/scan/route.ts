import { NextRequest, NextResponse } from "next/server";
import { fetchSiteSafely } from "@/lib/fetch-site";
import { detectTechnologies } from "@/lib/detect";
import { resolveCorsOrigin, corsHeaders } from "@/lib/cors";

// This route resolves DNS and streams a raw fetch response, which needs the
// full Node.js runtime (not the Edge runtime).
export const runtime = "nodejs";

// Best-effort in-memory rate limit: caps abuse per server instance. Note this
// resets on every serverless cold start / redeploy — for real abuse protection
// at scale, front this with Vercel's edge rate limiting or Upstash Ratelimit.
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 10;
const hits = new Map<string, number[]>();

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > MAX_REQUESTS_PER_WINDOW;
}

// Browsers preflight cross-origin POSTs with JSON bodies. Reply with the same
// allow/deny decision the real POST would make, so the browser knows whether
// to even send the follow-up request.
export async function OPTIONS(req: NextRequest) {
  const origin = resolveCorsOrigin(req.headers.get("origin"));
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}

export async function POST(req: NextRequest) {
  const origin = resolveCorsOrigin(req.headers.get("origin"));
  const headers = corsHeaders(origin);
  const json = (body: unknown, status: number) =>
    NextResponse.json(body, { status, headers });

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  if (isRateLimited(ip)) {
    return json({ error: "Too many scans from this IP. Try again in a minute." }, 429);
  }

  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  const rawUrl = (body.url ?? "").trim();
  if (!rawUrl) {
    return json({ error: "Enter a URL to scan." }, 400);
  }

  // Be forgiving if someone types "example.com" without a scheme — but only when
  // there's no scheme at all. If they typed some other scheme (ftp://, file://,
  // javascript:, ...), leave it as-is so assertSafeUrl rejects it with a clear
  // "only http/https" message instead of us mangling it into a bogus https:// URL.
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(rawUrl);
  const normalizedUrl = hasScheme ? rawUrl : `https://${rawUrl}`;

  try {
    const result = await fetchSiteSafely(normalizedUrl);
    const technologies = detectTechnologies({
      html: result.html,
      headers: result.headers,
      cookies: result.cookies,
      finalUrl: result.finalUrl,
    });

    return json(
      {
        requestedUrl: rawUrl,
        finalUrl: result.finalUrl,
        statusCode: result.statusCode,
        scannedAt: new Date().toISOString(),
        technologies,
        meta: {
          server: result.headers["server"] ?? null,
          poweredBy: result.headers["x-powered-by"] ?? null,
        },
      },
      200
    );
  } catch (err) {
    // Duck-type rather than `instanceof` — bundlers can duplicate the ScanError
    // class across chunks (route handler vs. shared lib), which breaks instanceof.
    if (typeof err === "object" && err !== null && (err as any).isScanError === true) {
      return json({ error: (err as Error).message }, 422);
    }
    console.error("Unexpected scan error:", err);
    return json({ error: "Something went wrong scanning that site." }, 500);
  }
}
