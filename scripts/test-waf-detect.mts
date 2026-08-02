/**
 * Offline test for lib/waf-detect.ts. Pure function, no network involved —
 * runs against static HTML/header/cookie fixtures, including a reproduction
 * of the real walla.co.il block page (HTTP 200, custom-branded WAF with no
 * known vendor fingerprint) that motivated this feature.
 * Run with: npx tsx scripts/test-waf-detect.mts
 */
import { detectBotBlock } from "../lib/waf-detect";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  console.log(`${cond ? "PASS" : "FAIL"} — ${label}${detail ? ` (${detail})` : ""}`);
  if (!cond) failures++;
}

// Case 1: the exact walla.co.il-style block page — no known vendor fingerprint,
// just a short, technology-free page whose title/H1 announce a block.
const wallaLikeHtml = `<HTML><HEAD><base href="/" />
<script type="text/javascript">var _event_transid='1927244991';</script>
<TITLE>Unauthorized Request Blocked</TITLE>
</HEAD><BODY><H1>Unauthorized Activity Detected</H1></BODY></HTML>`;
const walla = detectBotBlock(wallaLikeHtml, {}, [], 0);
check("Catches a custom-branded block page via the generic heuristic", walla.blocked === true && walla.vendor === null, JSON.stringify(walla));

// Case 2: Cloudflare's "checking your browser" interstitial.
const cf = detectBotBlock(
  "<html><body>Checking your browser before accessing example.com. This process is automatic.</body></html>",
  {},
  [],
  0
);
check("Detects Cloudflare via body text", cf.blocked === true && cf.vendor === "Cloudflare", JSON.stringify(cf));

// Case 3: Akamai identified by its bot-manager cookie, even with an otherwise normal-looking page.
const akamai = detectBotBlock("<html><body>Some page</body></html>", {}, ["ak_bmsc=abc123; Path=/"], 0);
check("Detects Akamai via ak_bmsc cookie", akamai.blocked === true && akamai.vendor === "Akamai", JSON.stringify(akamai));

// Case 4: Incapsula identified by its incident-ID marker in the body.
const incapsula = detectBotBlock(
  "<html><body>Incapsula incident ID: 12345-67890</body></html>",
  {},
  [],
  0
);
check("Detects Imperva/Incapsula via incident ID text", incapsula.blocked === true && incapsula.vendor === "Imperva / Incapsula", JSON.stringify(incapsula));

// Case 5: DataDome identified by its response header.
const datadome = detectBotBlock("<html><body>blocked</body></html>", { "x-datadome": "1" }, [], 0);
check("Detects DataDome via x-datadome header", datadome.blocked === true && datadome.vendor === "DataDome", JSON.stringify(datadome));

// Case 6 — the important negative case: a normal, content-rich page must NOT be
// flagged, even if detected technologies is low, as long as it doesn't match the
// sparse+keyword shape of a block page.
const normalSite = detectBotBlock(
  "<html><head><title>Acme Co — Handmade Candles</title></head><body>" +
    "<h1>Welcome to Acme Co</h1><p>We sell small-batch soy candles shipped worldwide. " +
    "Browse our collection, read customer reviews, and check out securely.</p>".repeat(20) +
    "</body></html>",
  {},
  [],
  3
);
check("Does not flag a normal, tech-detected page", normalSite.blocked === false, JSON.stringify(normalSite));

// Case 7: a small page that happens to mention "security" in a benign way, but
// isn't sparse/tech-free, should not trigger the generic heuristic.
const benignMention = detectBotBlock(
  ("<html><head><title>Our security check process</title></head><body>" +
    "<h1>How our security check works</h1><p>We take a layered approach to protecting customer data, " +
    "including a full security check before every release, third-party audits, and a bug bounty program. " +
    "Read our full transparency report for details on our review process and past incidents.</p>").repeat(10) +
    "</body></html>",
  {},
  [],
  4
);
check("Does not flag a benign 'security check' mention on a tech-detected page", benignMention.blocked === false, JSON.stringify(benignMention));

// Case 8: a small page with a keyword match but technologies WERE detected —
// should not fire, since the generic heuristic requires zero detected tech.
const smallButHasTech = detectBotBlock(
  "<title>Access denied for this resource</title>",
  {},
  [],
  1
);
check("Requires zero detected technologies for the generic heuristic to fire", smallButHasTech.blocked === false, JSON.stringify(smallButHasTech));

console.log(`\n${failures === 0 ? "All WAF-detection cases passed." : `${failures} case(s) failed.`}`);
process.exit(failures === 0 ? 0 : 1);
