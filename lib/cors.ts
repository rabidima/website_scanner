/**
 * CORS for the scan API routes. These are called from a domain we don't
 * control the server for (a Shopify storefront), so the browser will send an
 * Origin header and expect it echoed back before it'll let the page read the
 * response. Note this is NOT the security boundary for the routes — SSRF
 * protection (ssrf-guard.ts) and rate limiting (route.ts) are what stop abuse.
 * CORS here only controls which *browser pages* are allowed to read results;
 * it does nothing to stop direct server-to-server calls, which is expected.
 *
 * Configure via the ALLOWED_ORIGINS env var: a comma-separated list of exact
 * origins, e.g. "https://mystore.com,https://mystore.myshopify.com". Set it
 * to "*" to allow any origin — safe to do here since these routes no longer
 * use cookies (see lib/gate.ts: the free-scan/email gate moved to IP-based
 * tracking + an explicit Authorization header instead of Set-Cookie, since
 * cross-site cookies between this app's domain and the storefront domain get
 * silently blocked by browsers' third-party cookie policies).
 */

const DEV_ORIGINS = ["http://localhost:3000"];

function configuredOrigins(): string[] {
  const raw = process.env.ALLOWED_ORIGINS;
  if (!raw) return [];
  return raw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

export function resolveCorsOrigin(requestOrigin: string | null): string | null {
  if (!requestOrigin) return null;
  const allowed = configuredOrigins();
  if (allowed.includes("*")) return requestOrigin;
  if (allowed.includes(requestOrigin)) return requestOrigin;
  if (process.env.NODE_ENV !== "production" && DEV_ORIGINS.includes(requestOrigin)) {
    return requestOrigin;
  }
  return null;
}

export function corsHeaders(allowedOrigin: string | null): Record<string, string> {
  if (!allowedOrigin) return {};
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
