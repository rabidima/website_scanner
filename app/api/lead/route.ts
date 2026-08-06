import { NextRequest, NextResponse } from "next/server";
import { resolveCorsOrigin, corsHeaders } from "@/lib/cors";
import { validateEmail } from "@/lib/email-validate";
import { verifiedCookie } from "@/lib/gate";
import { recordLeadBestEffort } from "@/lib/shopify";

export const runtime = "nodejs";

// Separate, tight rate limit — this endpoint does a DNS lookup per request,
// which is cheap but not free, and is the entry point for the whole gate.
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 8;
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
    return json({ error: "Too many attempts. Try again in a minute." }, 429);
  }

  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  const rawEmail = (body.email ?? "").trim();
  if (!rawEmail) {
    return json({ error: "Enter your email address." }, 400);
  }

  const result = await validateEmail(rawEmail);
  if (!result.valid) {
    return json({ error: result.reason }, 422);
  }

  const email = rawEmail.toLowerCase();

  // Never let Shopify latency/errors block unlocking the gate for the user —
  // this is marketing lead capture, not the gate itself.
  recordLeadBestEffort(email);

  let cookie: string;
  try {
    cookie = verifiedCookie(email);
  } catch (err) {
    console.error("Failed to sign verified cookie:", err);
    return json({ error: "This deployment isn't fully configured yet. Try again shortly." }, 500);
  }

  return json({ ok: true }, 200, { "Set-Cookie": cookie });
}
