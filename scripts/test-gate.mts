/**
 * Offline test for lib/gate.ts — cookie signing/verification and the
 * free-scan/verified access decision. No network calls involved.
 * Run with: npx tsx scripts/test-gate.mts
 */
process.env.GATE_SECRET = "test-secret-do-not-use-in-prod";

const { signVerifiedToken, verifyToken, checkScanAccess, freeScanUsedCookie, verifiedCookie } = await import(
  "../lib/gate"
);

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  console.log(`${cond ? "PASS" : "FAIL"} — ${label}${detail ? ` (${detail})` : ""}`);
  if (!cond) failures++;
}

function fakeRequest(cookies: Record<string, string>): any {
  return {
    cookies: {
      get: (name: string) => (name in cookies ? { name, value: cookies[name] } : undefined),
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

  // Case 5: someone can't just hand-set ms_verified=email@x.com — an
  // unsigned raw string is not a valid two-part token and gets rejected.
  check("Rejects a plain unsigned email as a fake cookie", verifyToken("attacker@evil.com") === null);

  // Case 6: checkScanAccess — no cookies at all -> free scan allowed.
  const freshAccess = checkScanAccess(fakeRequest({}));
  check("No cookies -> free scan allowed", freshAccess.allowed === true && freshAccess.reason === "free-scan");

  // Case 7: free-scan-used cookie present, no verified cookie -> denied.
  const usedAccess = checkScanAccess(fakeRequest({ ms_free_used: "1" }));
  check("Free scan spent, no email -> gated", usedAccess.allowed === false && usedAccess.reason === "gate");

  // Case 8: verified cookie present -> allowed regardless of free-scan cookie.
  const verifiedToken = signVerifiedToken("dimas@example.com");
  const verifiedAccess = checkScanAccess(fakeRequest({ ms_free_used: "1", ms_verified: verifiedToken }));
  check(
    "Valid verified cookie -> unlimited access",
    verifiedAccess.allowed === true && verifiedAccess.reason === "verified" && (verifiedAccess as any).email === "dimas@example.com"
  );

  // Case 9: a garbage verified cookie value falls back to the free-scan check
  // rather than crashing the request.
  const garbageVerified = checkScanAccess(fakeRequest({ ms_verified: "garbage" }));
  check("Garbage verified cookie falls back to free-scan check, doesn't throw", garbageVerified.allowed === true);

  // Case 10: Set-Cookie strings carry the SameSite=None; Secure attributes
  // required for cross-site (Shopify storefront -> Vercel API) cookies.
  check("freeScanUsedCookie sets SameSite=None; Secure", /SameSite=None/.test(freeScanUsedCookie()) && /Secure/.test(freeScanUsedCookie()));
  check("verifiedCookie sets SameSite=None; Secure", /SameSite=None/.test(verifiedCookie("a@b.com")) && /Secure/.test(verifiedCookie("a@b.com")));

  console.log(`\n${failures === 0 ? "All gate cases passed." : `${failures} case(s) failed.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

run();
