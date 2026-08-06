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
 * origins, e.g. "https://mystore.com,https://mystore.myshopify.com".
 *
 * IMPORTANT — the free-scan/email gate (lib/gate.ts) relies on cookies sent
 * cross-site from the Shopify storefront to this app's domain. Browsers
 * refuse to send or expose cookies on credentialed requests when the
 * response uses "Access-Control-Allow-Origin: *" — the wildcard is
 * incompatible with credentials. Once the gate is live, ALLOWED_ORIGINS
 * MUST be an explicit origin list, not "*", or the gate will silently stop
 * working (every request will look like a fresh, ungated visitor).
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
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
