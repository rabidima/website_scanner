import { NextRequest, NextResponse } from "next/server";
import { runAiVisibilityCheck } from "@/lib/ai-visibility";
import { resolveCorsOrigin, corsHeaders } from "@/lib/cors";
import { checkScanAccess, freeScanUsedCookie } from "@/lib/gate";

export const runtime = "nodejs";
// Querying up to 4 LLM providers for up to 5 prompts (run in parallel, but
// each individual call can still take several seconds) needs real headroom —
// same rationale as the PageSpeed route's maxDuration.
export const maxDuration = 60;

// Tight rate limit: each request can fan out to as many as 20 LLM API calls
// (4 providers x 5 prompts), all billed against the agency's own provider
// accounts. Same in-memory-per-instance caveat as the other routes.
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 3;
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
    return json({ error: "Too many AI visibility checks from this IP. Try again in a minute." }, 429);
  }

  const access = checkScanAccess(req);
  if (!access.allowed) {
    return json(
      { error: "gate", message: "You've used your free scan. Enter your email to keep scanning." },
      403
    );
  }

  let body: { domain?: string; prompts?: string[] };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  const domain = (body.domain ?? "").trim();
  if (!domain) {
    return json({ error: "A domain is required." }, 400);
  }

  const prompts = Array.isArray(body.prompts) ? body.prompts.filter((p) => typeof p === "string" && p.trim()) : [];
  if (prompts.length === 0) {
    return json({ error: "Enter at least one prompt to check." }, 400);
  }

  const apiKeys = {
    openai: process.env.OPENAI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
    perplexity: process.env.PERPLEXITY_API_KEY,
  };

  if (!apiKeys.openai && !apiKeys.anthropic && !apiKeys.gemini && !apiKeys.perplexity) {
    return json(
      { error: "No AI provider API keys are configured. Set at least one of OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, PERPLEXITY_API_KEY." },
      500
    );
  }

  const result = await runAiVisibilityCheck(domain, prompts, apiKeys);
  return json(
    result,
    200,
    access.grantFreeScanCookie ? { "Set-Cookie": freeScanUsedCookie() } : undefined
  );
}
