import crypto from "node:crypto";
import { NextRequest } from "next/server";

/**
 * Free-scan-then-email-unlock gate.
 *
 * Two cookies:
 *  - ms_free_used: plain "1" flag. Set after the first (free, no-email) scan.
 *    Not signed — there's nothing sensitive to protect; worst case someone
 *    clears cookies and gets another free scan, which is an acceptable MVP
 *    gap (same tier of leniency as the mockup's original client-side flag).
 *  - ms_verified: HMAC-signed token carrying the email + expiry. THIS one is
 *    signed, because it's what grants unlimited access — without a signature
 *    anyone could hand-set `ms_verified=x@y.com` in devtools and skip the
 *    email gate entirely.
 *
 * Cross-origin note: this API is called from a Shopify storefront domain,
 * not this app's own domain, so these cookies are third-party/cross-site
 * from the browser's point of view. That requires:
 *   - SameSite=None; Secure on both cookies (done below)
 *   - the client fetch() call to use `credentials: "include"`
 *   - the CORS response to send a specific origin (not "*") plus
 *     Access-Control-Allow-Credentials: true (handled in lib/cors.ts)
 * If ALLOWED_ORIGINS is set to "*", browsers will silently refuse to store
 * or send these cookies — the gate will look like it's not working. Use an
 * explicit origin allowlist once this ships.
 */

const FREE_SCAN_COOKIE = "ms_free_used";
const VERIFIED_COOKIE = "ms_verified";

const FREE_SCAN_MAX_AGE_SEC = 60 * 60 * 24 * 365; // 1 year
const VERIFIED_MAX_AGE_SEC = 60 * 60 * 24 * 180; // 180 days
const VERIFIED_TTL_MS = VERIFIED_MAX_AGE_SEC * 1000;

function getSecret(): string {
  const secret = process.env.GATE_SECRET;
  if (!secret) {
    throw new Error("GATE_SECRET is not configured on this deployment.");
  }
  return secret;
}

function sign(payloadB64: string): string {
  return crypto.createHmac("sha256", getSecret()).update(payloadB64).digest("hex");
}

export function signVerifiedToken(email: string): string {
  const exp = Date.now() + VERIFIED_TTL_MS;
  const payloadB64 = Buffer.from(JSON.stringify({ email, exp }), "utf8").toString("base64url");
  return `${payloadB64}.${sign(payloadB64)}`;
}

export function verifyToken(token: string | undefined | null): { email: string } | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;

  let expectedSig: string;
  try {
    expectedSig = sign(payloadB64);
  } catch {
    return null; // GATE_SECRET missing — fail closed
  }

  const sigBuf = Buffer.from(sig, "hex");
  const expectedBuf = Buffer.from(expectedSig, "hex");
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  let parsed: { email?: unknown; exp?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (typeof parsed.email !== "string" || typeof parsed.exp !== "number") return null;
  if (Date.now() > parsed.exp) return null;

  return { email: parsed.email };
}

export type ScanAccess =
  | { allowed: true; reason: "verified"; email: string; grantFreeScanCookie: false }
  | { allowed: true; reason: "free-scan"; grantFreeScanCookie: true }
  | { allowed: false; reason: "gate" };

/** Reads cookies off an incoming request and decides whether a scan is allowed. */
export function checkScanAccess(req: NextRequest): ScanAccess {
  const verified = verifyToken(req.cookies.get(VERIFIED_COOKIE)?.value);
  if (verified) {
    return { allowed: true, reason: "verified", email: verified.email, grantFreeScanCookie: false };
  }

  const freeUsed = req.cookies.get(FREE_SCAN_COOKIE)?.value === "1";
  if (!freeUsed) {
    return { allowed: true, reason: "free-scan", grantFreeScanCookie: true };
  }

  return { allowed: false, reason: "gate" };
}

/** Set-Cookie value that marks the free scan as spent. */
export function freeScanUsedCookie(): string {
  return `${FREE_SCAN_COOKIE}=1; Path=/; Max-Age=${FREE_SCAN_MAX_AGE_SEC}; SameSite=None; Secure; HttpOnly`;
}

/** Set-Cookie value that unlocks unlimited scans for a validated email. */
export function verifiedCookie(email: string): string {
  return `${VERIFIED_COOKIE}=${signVerifiedToken(email)}; Path=/; Max-Age=${VERIFIED_MAX_AGE_SEC}; SameSite=None; Secure; HttpOnly`;
}
