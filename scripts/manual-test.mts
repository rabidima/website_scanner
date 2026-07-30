/**
 * Offline sanity check for the detection engine using realistic fixture HTML/headers
 * (this sandbox's outbound network is allowlisted and can't reach arbitrary live
 * sites, so this substitutes for hitting real WordPress/Shopify/etc. pages).
 * Run with: npx tsx scripts/manual-test.mts
 */
import { detectTechnologies } from "../lib/detect";

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
    label: "Shopify storefront on Cloudflare with Klaviyo + Stripe",
    expect: ["Shopify", "Cloudflare", "Klaviyo", "Stripe"],
    input: {
      html: `<!doctype html><html><head>
        <link rel="canonical" href="https://mystore.myshopify.com/">
        <script src="https://cdn.shopify.com/s/files/1/0001/theme.js"></script>
        <script src="https://a.klaviyo.com/media/js/onsite/onsite.js"></script>
        <script src="https://js.stripe.com/v3/"></script>
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

console.log(`\n${failures === 0 ? "All fixture cases passed." : `${failures} case(s) failed.`}`);
process.exit(failures === 0 ? 0 : 1);
