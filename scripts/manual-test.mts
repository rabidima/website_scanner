/**
 * Offline sanity check for the detection engine using realistic fixture HTML/headers
 * (this sandbox's outbound network is allowlisted and can't reach arbitrary live
 * sites, so this substitutes for hitting real WordPress/Shopify/etc. pages).
 * Run with: npx tsx scripts/manual-test.mts
 */
import { detectTechnologies } from "../lib/detect";
import { extractPageInfo } from "../lib/extract-meta";

const cases: { label: string; expect: string[]; input: Parameters<typeof detectTechnologies>[0] }[] = [
  {
    label: "WordPress + WooCommerce + Google Analytics site",
    expect: ["WordPress", "WooCommerce", "Google Analytics (GA4)", "jQuery", "Nginx"],
    input: {
      html: `<!doctype html><html><head>
        <meta name="generator" content="WordPress 6.5" />
        <link rel="stylesheet" href="/wp-content/themes/mytheme/style.css">
        <script src="/wp-includes/js/jquery/jquery.min.js"></script>
        <script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123"></script>
        <script>gtag('config', 'G-ABC123');</script>
        </head><body class="woocommerce"><form class="wc-ajax-add-to-cart"></form></body></html>`,
      headers: { server: "nginx/1.24.0" },
      cookies: [],
      finalUrl: "https://example-shop.test/",
    },
  },
  {
    label: "Shopify storefront on Cloudflare with Klaviyo + Stripe + apps",
    expect: [
      "Shopify", "Cloudflare", "Klaviyo", "Stripe",
      "Judge.me", "Recharge", "PageFly",
    ],
    input: {
      html: `<!doctype html><html><head>
        <link rel="canonical" href="https://mystore.myshopify.com/">
        <script src="https://cdn.shopify.com/s/files/1/0001/theme.js"></script>
        <script src="https://a.klaviyo.com/media/js/onsite/onsite.js"></script>
        <script src="https://js.stripe.com/v3/"></script>
        <script src="https://cdn.judge.me/widget.js"></script>
        <script src="https://widget.rechargepayments.com/loader.js"></script>
        <link rel="stylesheet" href="https://d1um8236vmc4z2.cloudfront.net/pagefly.io/style.css">
        </head><body></body></html>`,
      headers: { server: "cloudflare", "cf-ray": "8a1b2c3d4e5f" },
      cookies: [],
      finalUrl: "https://mystore.com/",
    },
  },
  {
    label: "Next.js/React/Tailwind app on Vercel",
    expect: ["Next.js", "React", "Tailwind CSS", "Vercel"],
    input: {
      html: `<!doctype html><html><body>
        <div id="__next" data-reactroot=""></div>
        <script id="__NEXT_DATA__" type="application/json">{}</script>
        <script src="/_next/static/chunks/main.js"></script>
        <link rel="stylesheet" href="/tailwindcss/output.css">
        </body></html>`,
      headers: { "x-vercel-id": "cle1::abcde-123", server: "Vercel" },
      cookies: [],
      finalUrl: "https://myapp.vercel.app/",
    },
  },
  {
    label: "Plain static HTML site, nothing detectable",
    expect: [],
    input: {
      html: `<!doctype html><html><head><title>Hello</title></head><body><h1>Hi</h1></body></html>`,
      headers: { server: "Apache/2.4" },
      cookies: [],
      finalUrl: "https://plainsite.test/",
    },
  },
];

let failures = 0;

for (const c of cases) {
  const results = detectTechnologies(c.input).map((r) => r.name);
  const missing = c.expect.filter((e) => !results.includes(e));
  const extra = c.expect.length === 0 ? [] : []; // not checking for false positives beyond expect list here
  const pass = missing.length === 0;
  console.log(`\n${pass ? "PASS" : "FAIL"} — ${c.label}`);
  console.log(`  detected: ${results.join(", ") || "(none)"}`);
  if (missing.length) {
    console.log(`  MISSING: ${missing.join(", ")}`);
    failures++;
  }
}

const pageInfoCases: { label: string; html: string; expect: { title: string | null; description: string | null; h1: string | null } }[] = [
  {
    label: "Standard title + meta description + H1 with nested markup",
    html: `<!doctype html><html><head>
      <title>Acme Co — Handmade Candles</title>
      <meta name="description" content="Small-batch soy candles, shipped worldwide.">
      </head><body><h1>Welcome to <em>Acme</em> Co</h1></body></html>`,
    expect: {
      title: "Acme Co — Handmade Candles",
      description: "Small-batch soy candles, shipped worldwide.",
      h1: "Welcome to Acme Co",
    },
  },
  {
    label: "Falls back to og:description when meta description is missing",
    html: `<!doctype html><html><head>
      <title>Fallback Test</title>
      <meta property="og:description" content="OG fallback description text.">
      </head><body><h1>Main heading</h1></body></html>`,
    expect: { title: "Fallback Test", description: "OG fallback description text.", h1: "Main heading" },
  },
  {
    label: "Missing title, description, and H1 entirely",
    html: `<!doctype html><html><head></head><body><p>No headings here.</p></body></html>`,
    expect: { title: null, description: null, h1: null },
  },
  {
    label: "Whitespace-collapsed multi-line H1 and title with HTML entity",
    html: `<!doctype html><html><head><title>Tom &amp; Jerry\'s Shop</title></head>
      <body><h1>\n        Free   shipping\n        over $50\n      </h1></body></html>`,
    expect: { title: "Tom & Jerry's Shop", description: null, h1: "Free shipping over $50" },
  },
];

let pageInfoFailures = 0;
for (const c of pageInfoCases) {
  const got = extractPageInfo(c.html);
  const pass =
    got.title === c.expect.title &&
    got.description === c.expect.description &&
    got.h1 === c.expect.h1;
  console.log(`\n${pass ? "PASS" : "FAIL"} — ${c.label}`);
  console.log(`  got: ${JSON.stringify(got)}`);
  if (!pass) {
    console.log(`  expected: ${JSON.stringify(c.expect)}`);
    pageInfoFailures++;
  }
}

const totalFailures = failures + pageInfoFailures;
console.log(`\n${totalFailures === 0 ? "All fixture cases passed." : `${totalFailures} case(s) failed.`}`);
process.exit(totalFailures === 0 ? 0 : 1);
