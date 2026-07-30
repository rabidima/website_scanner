# StackScan

MVP tech-stack scanner. Paste a URL, get back a categorized report of the visible
technology stack (CMS, JS framework, analytics, CDN/hosting, payment, fonts, chat
widgets, etc.) — same idea as Wappalyzer/BuiltWith, scoped down to a ~55-signature
MVP set built from scratch (no scraped third-party database, so no licensing
entanglement).

## Stack

- Next.js 14 (App Router) + TypeScript, single deployable app — UI and API in one project.
- No database, no auth, no external API dependency. Fully self-contained.
- Detection engine: `lib/detect.ts` — signature table matched against HTML body,
  response headers, and cookies. Add a technology by adding one entry to `SIGNATURES`.
- Safety: `lib/ssrf-guard.ts` + `lib/fetch-site.ts` — since this fetches whatever URL
  a stranger submits, from our server, it validates scheme, resolves DNS itself, and
  rejects private/reserved/loopback/link-local IP ranges (including the
  `169.254.169.254` cloud metadata address) before ever issuing the real request —
  and re-checks on every redirect hop, not just the first one.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Deploy to Vercel (recommended path)

1. Push this folder to a new GitHub repo.
2. Go to vercel.com → **Add New Project** → import that repo.
3. Framework preset auto-detects as Next.js. No environment variables needed. Click Deploy.
4. You'll have a live `*.vercel.app` URL in about a minute. Attach a custom domain
   under Project Settings → Domains whenever you're ready.

Or from the CLI, from inside this folder:

```bash
npm install -g vercel
vercel        # preview deploy
vercel --prod # production deploy
```

## Embedding on a Shopify store

See `SHOPIFY.md` — deploy this app to Vercel as the backend, then drop a
small snippet into your theme (`shopify/custom-liquid-embed.html` for a
native-styled embed, or `shopify/iframe-embed.html` for a 2-minute iframe).
The API route supports CORS via the `ALLOWED_ORIGINS` env var for exactly
this use case.

## What it detects (v0.1 signature set)

CMS: WordPress, Shopify, Wix, Squarespace, Webflow, Drupal, Joomla, Ghost, HubSpot CMS.
Ecommerce: WooCommerce, Magento, BigCommerce. JS frameworks: Next.js, React, Vue,
Nuxt, Angular, Svelte, jQuery, Alpine.js. CSS: Bootstrap, Tailwind. Analytics: GA4,
Meta Pixel, Hotjar, Segment, Mixpanel, Microsoft Clarity. Tag managers: GTM. CDN/host:
Cloudflare, Vercel, Netlify, CloudFront, Fastly, GitHub Pages. Web server: Nginx,
Apache, IIS, LiteSpeed, PHP, Express, ASP.NET (from response headers). Payment:
Stripe, PayPal, Klarna. Fonts: Google Fonts, Adobe Fonts. Chat: Intercom, Zendesk,
Drift, Crisp, Tawk.to. Email/marketing: Klaviyo, Mailchimp.

This only sees what a browser sees (client-side markers) plus response headers — it
won't detect server-side-only tooling (backend language/framework choices that leave
no client trace, internal infra, etc.). That's expected for an MVP; extending
coverage is just adding more entries to `SIGNATURES`.

## Known limitations / next steps

- **Rate limiting is per-instance, in-memory** (`app/api/scan/route.ts`). It resets on
  every cold start / redeploy, so it's a soft abuse deterrent, not a hard guarantee.
  For real scale, front it with Vercel's edge rate limiting or Upstash Ratelimit + a
  shared store (Redis).
- **postcss has two known high-severity advisories** as a transitive dev dependency
  of Next.js tooling (source-map path traversal, build-time only — not reachable at
  runtime since this app doesn't process untrusted CSS). Run `npm audit` after
  install; a `next@16` upgrade would clear it but is a breaking change we didn't take
  for this MVP. Fine to ship as-is, worth revisiting before this scales.
- **Signature set is intentionally narrow (~55 checks).** Coverage grows linearly
  with entries added to `lib/detect.ts` — no architecture change needed to extend it.
- **No scan history / persistence.** Every scan is stateless. If you want a "recent
  scans" feed or shareable report links, that's a Postgres table + one more route
  away (e.g. Vercel Postgres or Supabase).
