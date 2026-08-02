export interface BotBlockResult {
  blocked: boolean;
  vendor: string | null;
}

type VendorTest = (headers: Record<string, string>, cookies: string[], html: string) => boolean;

// Known anti-bot / WAF vendors identifiable by header or cookie fingerprints.
// These are the most reliable signal — a vendor cookie or header essentially
// never appears unless that vendor's edge actually intercepted the request.
const VENDOR_SIGNATURES: { vendor: string; test: VendorTest }[] = [
  {
    vendor: "Cloudflare",
    test: (headers, _cookies, html) =>
      !!headers["cf-mitigated"] ||
      /attention required.{0,20}cloudflare|checking your browser before accessing|cf-error-details/i.test(html),
  },
  {
    vendor: "Akamai",
    test: (headers, cookies) =>
      Object.keys(headers).some((h) => h.startsWith("x-akamai")) ||
      cookies.some((c) => /^(ak_bmsc|bm_sv|_abck)=/.test(c)),
  },
  {
    vendor: "Imperva / Incapsula",
    test: (_headers, cookies, html) =>
      cookies.some((c) => /^(incap_ses|visid_incap)/.test(c)) ||
      /incapsula incident id|_incapsula_resource/i.test(html),
  },
  {
    vendor: "PerimeterX / HUMAN",
    test: (_headers, cookies, html) =>
      cookies.some((c) => c.startsWith("_px")) || /px-captcha|please verify you are a human/i.test(html),
  },
  {
    vendor: "DataDome",
    test: (headers, cookies) => !!headers["x-datadome"] || cookies.some((c) => c.startsWith("datadome=")),
  },
  {
    vendor: "Radware",
    test: (headers) => /radware|appwall/i.test(headers["server"] ?? ""),
  },
];

// Generic fallback: no known vendor fingerprint matched, but the response has the
// unmistakable shape of a bot-block page — a short, content-free body whose
// title/H1 announces a block. This is how custom-branded WAFs (like the one
// walla.co.il uses, which doesn't carry any of the signatures above) get caught.
const GENERIC_BLOCK_PATTERN =
  /unauthorized (request|activity)|access (is )?denied|request blocked|blocked by (our )?(security|firewall)|suspicious activity detected|automated (access|requests?) (is|are|has been) blocked|bot detected|are you a (robot|human)|security check|checking your browser/i;

// The generic heuristic only fires when the page is otherwise "empty" — a real,
// content-rich page that happens to mention "security check" in a blog post
// won't also have zero detected technologies and a tiny body, so this stays
// safe from false positives on normal sites.
const GENERIC_MAX_BODY_LENGTH = 6000;

export function detectBotBlock(
  html: string,
  headers: Record<string, string>,
  cookies: string[],
  technologiesDetected: number
): BotBlockResult {
  for (const sig of VENDOR_SIGNATURES) {
    if (sig.test(headers, cookies, html)) {
      return { blocked: true, vendor: sig.vendor };
    }
  }

  const isSparse = technologiesDetected === 0 && html.length < GENERIC_MAX_BODY_LENGTH;
  if (isSparse && GENERIC_BLOCK_PATTERN.test(html)) {
    return { blocked: true, vendor: null };
  }

  return { blocked: false, vendor: null };
}
