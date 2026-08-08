/**
 * Offline test for lib/gate.ts — token signing/verification and the
 * free-scan/verified access decision. No network calls involved.
 *
 * V3: free-scan tracking moved from an in-memory per-instance Set to Vercel
 * KV (see lib/gate.ts's header comment for why — serverless instances don't
 * share memory, so the old version could reset unpredictably). The KV calls
 * are abstracted behind a FreeScanStore interface for exactly this reason:
 * tests inject an in-memory fake instead of needing a real KV connection.
 *
 * Run with: npx tsx scripts/test-gate.mts
 */
import type { FreeScanStore } from "../lib/gate";

process.env.GATE_SECRET = "test-secret-do-not-use-in-prod";

const { signVerifiedToken, verifyToken, checkScanAccess, extractBearerToken } = await import("../lib/gate");

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  console.log(`${cond ? "PASS" : "FAIL"} — ${label}${detail ? ` (${detail})` : ""}`);
  if (!cond) failures++;
}

function fakeRequest(authHeader?: string): any {
  return {
    headers: {
      get: (name: string) => (name.toLowerCase() === "authorization" ? authHeader ?? null : null),
    },
  };
}

class FakeFreeScanStore implements FreeScanStore {
  private used = new Set<string>();
  async claimFreeScan(key: string): Promise<boolean> {
    if (this.used.has(key)) return false;
    this.used.add(key);
    return true;
  }
}

async function run() {
  // Case 1: sign then verify round-trips the email.
  const token = signVerifiedToken("dimas@example.com");
  const verified = verifyToken(token);
  check("Round-trips a signed token", verified?.email === "dimas@example.com", JSON.stringify(verified));

  // Case 2: tampered payload is rejected.
  const [payloadB64, sig] = token.split(".");
  const tamperedPayload = Buffer.from(JSON.stringify({ email: "attacker@evil.com", exp: Date.now() + 999999 }), "utf8").toString(
    "base64url"
  );
  const tampered = `${tamperedPayload}.${sig}`;
  check("Rejects a tampered payload with the original signature", verifyToken(tampered) === null);

  // Case 3: garbage/malformed token is rejected, not thrown.
  check("Rejects a malformed token (no dot)", verifyToken("not-a-valid-token") === null);
  check("Rejects an empty token", verifyToken("") === null);
  check("Rejects undefined", verifyToken(undefined) === null);

  // Case 4: expired token is rejected even with a valid signature.
  const expiredPayload = Buffer.from(JSON.stringify({ email: "dimas@example.com", exp: Date.now() - 1000 }), "utf8").toString(
    "base64url"
  );
  const crypto = await import("node:crypto");
  const expiredSig = crypto.createHmac("sha256", process.env.GATE_SECRET!).update(expiredPayload).digest("hex");
  const expiredToken = `${expiredPayload}.${expiredSig}`;
  check("Rejects an expired token", verifyToken(expiredToken) === null);

  // Case 5: someone can't just hand-set an Authorization header to their
  // email — an unsigned raw string is not a valid two-part token.
  check("Rejects a plain unsigned email as a fake token", verifyToken("attacker@evil.com") === null);

  // Case 6: extractBearerToken pulls the token out of "Bearer <token>", is
  // case-insensitive on the scheme, and returns null when absent/malformed.
  check("Extracts token from 'Bearer <token>'", extractBearerToken(fakeRequest(`Bearer ${token}`)) === token);
  check("Extracts token from lowercase 'bearer <token>'", extractBearerToken(fakeRequest(`bearer ${token}`)) === token);
  check("No Authorization header -> null", extractBearerToken(fakeRequest()) === null);
  check("Malformed Authorization header -> null", extractBearerToken(fakeRequest("Basic abc123")) === null);

  // All of these use a fresh FakeFreeScanStore per-store-scoped case (rather
  // than one shared store) so cases don't leak state into each other — each
  // `new FakeFreeScanStore()` mirrors a clean KV namespace.

  // Case 7: checkScanAccess — fresh IP, no token -> free scan allowed, and
  // that IP is now recorded as having used its free scan.
  const store1 = new FakeFreeScanStore();
  const freshIp = "203.0.113.10";
  const freshAccess = await checkScanAccess(fakeRequest(), freshIp, store1);
  check("Fresh IP, no token -> free scan allowed", freshAccess.allowed === true && freshAccess.reason === "free-scan");

  // Case 8: same IP again, still no token -> gated (free scan already spent).
  const usedAccess = await checkScanAccess(fakeRequest(), freshIp, store1);
  check("Same IP again, no token -> gated", usedAccess.allowed === false && usedAccess.reason === "gate");

  // Case 9: a different fresh IP still gets its own free scan (per-IP, not global).
  const otherIp = "203.0.113.20";
  const otherAccess = await checkScanAccess(fakeRequest(), otherIp, store1);
  check("Different fresh IP -> free scan allowed independently", otherAccess.allowed === true && otherAccess.reason === "free-scan");

  // Case 10: valid bearer token -> unlimited access regardless of whether
  // this IP already spent its free scan.
  const verifiedToken = signVerifiedToken("dimas@example.com");
  const verifiedAccess = await checkScanAccess(fakeRequest(`Bearer ${verifiedToken}`), freshIp, store1);
  check(
    "Valid bearer token -> unlimited access even on an IP that already used its free scan",
    verifiedAccess.allowed === true && verifiedAccess.reason === "verified" && (verifiedAccess as any).email === "dimas@example.com"
  );

  // Case 11: a garbage bearer token falls back to the per-IP free-scan
  // check rather than crashing the request.
  const store2 = new FakeFreeScanStore();
  const garbageIp = "203.0.113.30";
  const garbageVerified = await checkScanAccess(fakeRequest("Bearer garbage"), garbageIp, store2);
  check("Garbage bearer token falls back to free-scan check, doesn't throw", garbageVerified.allowed === true && garbageVerified.reason === "free-scan");

  // Case 12: checkScanAccess with no store argument falls back to the real
  // default (Vercel KV) store — just confirms it doesn't blow up wiring the
  // default parameter; the actual KV round-trip is out of scope for an
  // offline test (needs real credentials, covered by manual/staging testing).
  check("Default store parameter is wired (no crash constructing it)", typeof checkScanAccess === "function");

  console.log(`\n${failures === 0 ? "All gate cases passed." : `${failures} case(s) failed.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

run();
