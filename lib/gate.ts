import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { Redis } from "@upstash/redis";

// Vercel KV as a standalone product is discontinued — Redis now lives under
// Vercel Marketplace, provisioned via Upstash. @vercel/kv (the old wrapper)
// is deprecated too, so this talks to @upstash/redis directly. fromEnv()
// reads UPSTASH_REDIS_REST_URL/TOKEN, falling back to KV_REST_API_URL/TOKEN
// — which is exactly what the Marketplace integration injects, so no env
// var renaming is needed on the Vercel side.
const kv = Redis.fromEnv();

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
 * V2 dropped cookies but tracked "have they had their free scan yet" in an
 * in-memory Set, keyed by IP. That turned out to be leaky in its own way:
 * Vercel runs serverless functions across multiple isolated instances with
 * no shared memory, so a retry (incognito, or just an unlucky cold start)
 * could land on an instance whose Set never saw that IP — the gate would
 * silently reset even though nothing about the visitor actually changed.
 *
 * V3 (this version) moves free-scan tracking into Vercel KV (Upstash Redis),
 * which every instance reads and writes the same way — no more per-instance
 * drift. "Are they verified" is still a signed token returned in the
 * /api/lead JSON response body; the client stores it itself (localStorage —
 * first-party, never blocked) and sends it back explicitly on every scan
 * request via `Authorization: Bearer <token>`. Nothing here depends on the
 * browser's cookie jar at all.
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

// A single "scan" from the browser's point of view is actually several
// independent API calls (tech stack, then SEO + AI in parallel). Each route
// calls checkScanAccess() on its own — which is correct, each one needs to
// be independently abuse-resistant, since nothing stops someone from calling
// /api/seo-rank or /api/ai-visibility directly without ever hitting
// /api/scan first. But it means a naive "claim the free scan" check on every
// route consumes a *separate* free-scan credit per call: the first call
// claims it, and every other call in the same batch immediately sees the
// credit already spent and gets gated — even though, from the visitor's
// perspective, this is still their one free scan.
//
// The fix is a short-lived scan-pass: whoever's first call actually claims
// the free-scan credit (currently always /api/scan, since the frontend now
// calls it first as a validity gate) mints this token and hands it back in
// the response. The frontend attaches it to the rest of that scan's calls
// via X-Scan-Pass, and those calls trust it instead of claiming another
// free-scan credit. It's deliberately not reusable across scans: 5 minutes
// is comfortably longer than a real scan takes, short enough that holding
// onto one isn't a meaningful way to dodge the gate.
const SCAN_PASS_TTL_MS = 5 * 60 * 1000;

export function signScanPass(): string {
  const exp = Date.now() + SCAN_PASS_TTL_MS;
  const payloadB64 = Buffer.from(JSON.stringify({ scan: true, exp }), "utf8").toString("base64url");
  return `${payloadB64}.${sign(payloadB64)}`;
}

function verifyScanPass(token: string | undefined | null): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payloadB64, sig] = parts;

  let expectedSig: string;
  try {
    expectedSig = sign(payloadB64);
  } catch {
    return false; // GATE_SECRET missing — fail closed
  }

  const sigBuf = Buffer.from(sig, "hex");
  const expectedBuf = Buffer.from(expectedSig, "hex");
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return false;
  }

  let parsed: { scan?: unknown; exp?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return false;
  }

  if (parsed.scan !== true || typeof parsed.exp !== "number") return false;
  if (Date.now() > parsed.exp) return false;

  return true;
}

/** Pulls the scan-pass token out of the X-Scan-Pass header, if present. */
export function extractScanPass(req: NextRequest): string | null {
  const header = req.headers.get("x-scan-pass");
  return header && header.trim() ? header.trim() : null;
}

// Free scan resets every 24h per IP. Not "once ever" on purpose — offices,
// cafes, and carrier NAT put many real visitors behind one IP, and a hard
// lifetime cap would gate out people who never got their own free scan in
// the first place. 24h is generous enough to be fair, tight enough that
// incognito/cold-start no longer lets the same visitor re-trigger it in the
// same sitting the way the old in-memory version accidentally allowed.
const FREE_SCAN_TTL_SEC = 60 * 60 * 24;

/**
 * Abstraction over "has this key already used its free scan today" so the
 * gate logic can be unit tested without a real KV connection — tests inject
 * an in-memory fake implementing the same interface.
 */
export interface FreeScanStore {
  /** Returns true if this call is the one claiming the free scan (i.e. it's
   *  allowed); false if it's already been claimed within the TTL window. */
  claimFreeScan(key: string): Promise<boolean>;
}

class KvFreeScanStore implements FreeScanStore {
  async claimFreeScan(key: string): Promise<boolean> {
    const redisKey = `free-scan:${key}`;
    const count = await kv.incr(redisKey);
    if (count === 1) {
      // Only set the expiry on the first hit — repeat hits within the window
      // shouldn't push the TTL back out, or a determined visitor could keep
      // themselves permanently gated-free by scanning right before it expires.
      await kv.expire(redisKey, FREE_SCAN_TTL_SEC);
    }
    return count === 1;
  }
}

const defaultFreeScanStore: FreeScanStore = new KvFreeScanStore();

export type ScanAccess =
  | { allowed: true; reason: "verified"; email: string }
  | { allowed: true; reason: "scan-pass" }
  | { allowed: true; reason: "free-scan" }
  | { allowed: false; reason: "gate" };

/** Decides whether a scan is allowed for this request + client IP. */
export async function checkScanAccess(
  req: NextRequest,
  ip: string,
  store: FreeScanStore = defaultFreeScanStore
): Promise<ScanAccess> {
  const verified = verifyToken(extractBearerToken(req));
  if (verified) {
    return { allowed: true, reason: "verified", email: verified.email };
  }

  // Rides along on the free-scan credit an earlier call in this same batch
  // already claimed — see the comment above extractScanPass for why this
  // exists. Checked before claimFreeScan so it never touches the counter.
  if (verifyScanPass(extractScanPass(req))) {
    return { allowed: true, reason: "scan-pass" };
  }

  const gotFreeScan = await store.claimFreeScan(ip);
  if (gotFreeScan) {
    return { allowed: true, reason: "free-scan" };
  }

  return { allowed: false, reason: "gate" };
}
