/**
 * Offline test for lib/gate.ts — token signing/verification and the
 * free-scan/verified access decision. No network calls involved.
 *
 * V2: gate state is no longer cookie-based (see lib/gate.ts's header
 * comment for why — cross-site cookies between the Vercel API domain and
 * the Shopify storefront domain get silently dropped by browsers). Access
 * is now decided from an explicit `Authorization: Bearer <token>` header
 * plus a server-side per-IP "used their free scan" set.
 *
 * Run with: npx tsx scripts/test-gate.mts
 */
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

  // Case 7: checkScanAccess — fresh IP, no token -> free scan allowed, and
  // that IP is now recorded as having used its free scan.
  const freshIp = "203.0.113.10";
  const freshAccess = checkScanAccess(fakeRequest(), freshIp);
  check("Fresh IP, no token -> free scan allowed", freshAccess.allowed === true && freshAccess.reason === "free-scan");

  // Case 8: same IP again, still no token -> gated (free scan already spent).
  const usedAccess = checkScanAccess(fakeRequest(), freshIp);
  check("Same IP again, no token -> gated", usedAccess.allowed === false && usedAccess.reason === "gate");

  // Case 9: a different fresh IP still gets its own free scan (per-IP, not global).
  const otherIp = "203.0.113.20";
  const otherAccess = checkScanAccess(fakeRequest(), otherIp);
  check("Different fresh IP -> free scan allowed independently", otherAccess.allowed === true && otherAccess.reason === "free-scan");

  // Case 10: valid bearer token -> unlimited access regardless of whether
  // this IP already spent its free scan.
  const verifiedToken = signVerifiedToken("dimas@example.com");
  const verifiedAccess = checkScanAccess(fakeRequest(`Bearer ${verifiedToken}`), freshIp);
  check(
    "Valid bearer token -> unlimited access even on an IP that already used its free scan",
    verifiedAccess.allowed === true && verifiedAccess.reason === "verified" && (verifiedAccess as any).email === "dimas@example.com"
  );

  // Case 11: a garbage bearer token falls back to the per-IP free-scan
  // check rather than crashing the request.
  const garbageIp = "203.0.113.30";
  const garbageVerified = checkScanAccess(fakeRequest("Bearer garbage"), garbageIp);
  check("Garbage bearer token falls back to free-scan check, doesn't throw", garbageVerified.allowed === true && garbageVerified.reason === "free-scan");

  console.log(`\n${failures === 0 ? "All gate cases passed." : `${failures} case(s) failed.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

run();
