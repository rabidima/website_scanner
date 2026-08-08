import { NextRequest, NextResponse } from "next/server";
import { checkSeoRank, SerperError } from "@/lib/serper";
import { resolveCorsOrigin, corsHeaders } from "@/lib/cors";
import { checkScanAccess } from "@/lib/gate";

export const runtime = "nodejs";

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

function isSerperError(err: unknown): err is SerperError {
  return typeof err === "object" && err !== null && (err as any).isSerperError === true;
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
    return json({ error: "Too many rank checks from this IP. Try again in a minute." }, 429);
  }

  const access = await checkScanAccess(req, ip);
  if (!access.allowed) {
    return json(
      { error: "gate", message: "You've used your free scan. Enter your email to keep scanning." },
      403
    );
  }

  let body: { domain?: string; keyword?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  const domain = (body.domain ?? "").trim();
  const keyword = (body.keyword ?? "").trim();
  if (!domain || !keyword) {
    return json({ error: "A domain and a keyword are both required." }, 400);
  }

  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    return json({ error: "SERPER_API_KEY is not configured on this deployment." }, 500);
  }

  try {
    const result = await checkSeoRank(keyword, domain, apiKey);
    return json(result, 200);
  } catch (err) {
    if (isSerperError(err)) {
      return json({ error: err.message }, 502);
    }
    console.error("Unexpected SEO rank check error:", err);
    return json({ error: "Something went wrong checking that keyword." }, 500);
  }
}
