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

## Performance diagnostics (Google PageSpeed Insights)

Separate from the tech-stack scan, there's an opt-in "Diagnose performance
issues" section that runs a real Lighthouse audit via Google's free
PageSpeed Insights API and shows Performance/Accessibility/Best
Practices/SEO scores for mobile and desktop. It's a distinct action (not
bundled into the main scan) because Lighthouse audits are slow — commonly
10-30+ seconds — so folding it into the instant tech-stack results would
make the whole scan feel broken.

To enable it: set `GOOGLE_PAGESPEED_API_KEY` on Vercel (Project Settings →
Environment Variables) and redeploy. See `.env.example` for how to get a
free key (no billing required, 25,000 requests/day). It'll technically work
without a key too, but unauthenticated PSI requests share a very small
global quota and will get rate-limited almost immediately under real use.

## AI visibility check (ChatGPT / Claude / Gemini / Perplexity)

An opt-in section that queries OpenAI, Anthropic, Google Gemini, and Perplexity
directly — no data-reseller markup — with up to 5 prompts you choose, and checks
whether the scanned domain gets mentioned in each response. Reports, per prompt
and per provider: mentioned yes/no, a snippet of the mention, any cited URL
pointing back at the domain (structural citations from providers that support
it, like Perplexity's Sonar models, or regex-extracted from the response text
otherwise), and a lightweight keyword-based sentiment heuristic (positive/
neutral/negative — not a real NLP model, documented as such in the UI).

This is a **live snapshot, not a historical tracker** — there's no database, so
nothing is stored between requests. Each provider is independently optional:
set any subset of `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` /
`PERPLEXITY_API_KEY` and the rest just show as "not configured" instead of
failing the check. See `.env.example` for where to get each key. Implementation:
`lib/ai-visibility.ts`, route: `app/api/ai-visibility/route.ts`.

## SEO rank check (Serper.dev)

A second opt-in section: enter a keyword, and it checks where the scanned
domain currently ranks in Google for that keyword (via Serper.dev's SERP API),
alongside the top 10 organic competitors and related-search / People Also Ask
terms as lightweight keyword-research ideas. Also a **live snapshot, not a
tracker** — same no-database caveat as AI visibility. Requires `SERPER_API_KEY`
(free tier: 2,500 credits, no card required). Implementation: `lib/serper.ts`,
route: `app/api/seo-rank/route.ts`.

**Explicitly out of scope for this pass**: backlink data (Serper is a SERP
scraper, not a link index — would need a separate vendor like Majestic's
self-serve API) and a deeper crawl-based technical site audit (partially
covered today by the existing PageSpeed Insights SEO category and the
title/meta/H1 extraction, but not a full audit). True historical rank/prompt
tracking (day-over-day trends) would need a Postgres database and a scheduled
job — see "No scan history / persistence" below.

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
- **PageSpeed audits can exceed short serverless timeouts on very slow sites.**
  `app/api/pagespeed/route.ts` requests the max `maxDuration` available on
  Vercel's free tier (60s); if a target is slow enough that Lighthouse itself
  exceeds that, the request will time out. Uncommon, but possible.
- **No scan history / persistence.** Every scan is stateless. If you want a "recent
  scans" feed or shareable report links, that's a Postgres table + one more route
  away (e.g. Vercel Postgres or Supabase).
