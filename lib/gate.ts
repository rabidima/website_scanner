import crypto from "node:crypto";
import { NextRequest } from "next/server";

/**
 * Free-scan-then-email-unlock gate.
 *
 * V1 of this used Set-Cookie for both the free-scan flag and the verified
 * token. That broke in practice: this API lives on a different origin
 * (vercel.app) than the page that calls it (the Shopify storefront), which
 * makes these third-party cookies from the browser's point of view — and
 * Chrome (by default in Incognito, and increasingly in normal windows as
 * third-party cookie deprecation rolls out) silently drops them. The cookie
 * would visibly get set once in DevTools but never get sent back on the next
 * request, so the gate looked like it wasn't working — every visit looked
 * like a fresh one.
 *
 * V2 (this version) doesn't rely on the browser automatically attaching
 * anything cross-site:
 *  - "Have they had their free scan yet" is tracked server-side, keyed by IP,
 *    in-memory — same best-effort-per-instance pattern as the rate limiters
 *    in the API routes (resets on cold start, not a hard guarantee, but
 *    doesn't depend on any client storage the browser might block).
 *  - "Are they verified" is a signed token returned in the /api/lead JSON
 *    response body. The client stores it itself (localStorage — first-party,
 *    never blocked) and sends it back explicitly on every scan request via
 *    `Authorization: Bearer <token>`. Nothing here depends on the browser's
 *    cookie jar at all.
 */

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

/** Pulls a bearer token out of the Authorization header, if present. */
export function extractBearerToken(req: NextRequest): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

// In-memory, per-instance IP set. Same caveat as the rate limiters: resets on
// cold start / redeploy, and IPs behind shared NAT (offices, cafes, carrier
// NAT) will affect each other. That's an acceptable MVP tradeoff — this is
// an abuse deterrent, not a hard security boundary, same tier of leniency as
// the old cookie-based version had.
const freeScanUsedByIp = new Set<string>();

export type ScanAccess =
  | { allowed: true; reason: "verified"; email: string }
  | { allowed: true; reason: "free-scan" }
  | { allowed: false; reason: "gate" };

/** Decides whether a scan is allowed for this request + client IP. */
export function checkScanAccess(req: NextRequest, ip: string): ScanAccess {
  const verified = verifyToken(extractBearerToken(req));
  if (verified) {
    return { allowed: true, reason: "verified", email: verified.email };
  }

  if (!freeScanUsedByIp.has(ip)) {
    freeScanUsedByIp.add(ip);
    return { allowed: true, reason: "free-scan" };
  }

  return { allowed: false, reason: "gate" };
}
