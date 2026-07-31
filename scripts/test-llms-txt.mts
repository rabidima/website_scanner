/**
 * Offline test for lib/llms-txt.ts. Mocks global.fetch since this sandbox
 * can't reach arbitrary external domains — and uses literal IP addresses
 * instead of hostnames in test URLs, since assertSafeUrl does a real
 * dns.lookup() for hostnames (which also fails offline here), but takes a
 * fast path straight to the IP check when the hostname is already a literal
 * IP. The redirect-to-private-IP case is the one that actually matters for
 * safety — everything else is UX polish.
 * Run with: npx tsx scripts/test-llms-txt.mts
 */
import { checkLlmsTxt } from "../lib/llms-txt";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  console.log(`${cond ? "PASS" : "FAIL"} — ${label}${detail ? ` (${detail})` : ""}`);
  if (!cond) failures++;
}

const realFetch = global.fetch;
function mockFetch(handler: (url: string) => Promise<Response>) {
  // @ts-expect-error test-only override
  global.fetch = handler;
}

// 203.0.113.0/24 is TEST-NET-3 (RFC 5737) — reserved for documentation, not
// in any of our blocked private/loopback/link-local ranges, so it exercises
// the "this is a public address" path without being a real live host.
const PUBLIC_IP = "203.0.113.5";
const PUBLIC_IP_2 = "203.0.113.6";

async function run() {
  // Case 1: llms.txt exists and is returned as-is.
  mockFetch(async () => new Response("# My Site\n\n> A summary for LLMs.", { status: 200 }));
  const found = await checkLlmsTxt(`http://${PUBLIC_IP}/some/page`);
  check("Finds llms.txt at the domain root", found.found === true && found.url === `http://${PUBLIC_IP}/llms.txt`, found.url);
  check("Returns the content unmodified when short", found.content === "# My Site\n\n> A summary for LLMs.");
  check("Not marked truncated when under the cap", found.truncated === false);

  // Case 2: 404 -> not found, no error thrown.
  mockFetch(async () => new Response("Not Found", { status: 404 }));
  const notFound = await checkLlmsTxt(`http://${PUBLIC_IP}`);
  check("404 reports found: false", notFound.found === false && notFound.content === null);

  // Case 3: a same-site redirect is followed and still works.
  mockFetch(async (url: string) => {
    if (url === `http://${PUBLIC_IP}/llms.txt`) {
      return new Response(null, { status: 301, headers: { location: `http://${PUBLIC_IP_2}/llms.txt` } });
    }
    return new Response("# Redirected content", { status: 200 });
  });
  const redirected = await checkLlmsTxt(`http://${PUBLIC_IP}`);
  check("Follows a legitimate same-site redirect", redirected.found === true && redirected.content === "# Redirected content");

  // Case 4: redirect loop past the cap is rejected, not followed forever.
  let hops = 0;
  mockFetch(async () => {
    hops++;
    return new Response(null, { status: 302, headers: { location: "/llms.txt?loop=" + hops } });
  });
  const loop = await checkLlmsTxt(`http://${PUBLIC_IP}`);
  check("Redirect loop is capped, not infinite", loop.found === false && hops <= 5, `hops=${hops}`);

  // Case 5 — the safety-critical one: a redirect to a private/internal IP is
  // rejected, not followed. This is what stops llms.txt from being used as an
  // SSRF vector (e.g. redirecting our server to cloud metadata).
  mockFetch(async (url: string) => {
    if (url === `http://${PUBLIC_IP}/llms.txt`) {
      return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } });
    }
    // If this ever gets called, the SSRF guard failed to block the hop.
    return new Response("SHOULD NOT BE REACHABLE", { status: 200 });
  });
  const ssrf = await checkLlmsTxt(`http://${PUBLIC_IP}`);
  check(
    "Redirect to cloud metadata IP is blocked, not followed",
    ssrf.found === false && ssrf.content === null,
    JSON.stringify(ssrf)
  );

  // Case 6: content over the cap gets truncated, not dropped or crashed on.
  mockFetch(async () => new Response("x".repeat(25_000), { status: 200 }));
  const big = await checkLlmsTxt(`http://${PUBLIC_IP}`);
  check("Oversized content is truncated to the cap", big.found === true && big.truncated === true && big.content?.length === 20_000, String(big.content?.length));

  global.fetch = realFetch;

  console.log(`\n${failures === 0 ? "All llms.txt cases passed." : `${failures} case(s) failed.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

run();
