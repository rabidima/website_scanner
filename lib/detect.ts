/**
 * StackScan detection engine.
 *
 * Signature-based tech fingerprinting, in the same spirit as Wappalyzer/BuiltWith:
 * we look for tell-tale strings in HTML, response headers, cookies, and script/link
 * URLs, and match them against a curated signature table. This is a from-scratch,
 * MIT-safe signature set (no scraped Wappalyzer DB), intentionally scoped to the
 * ~75 highest-signal, most common technologies for an MVP — including a
 * dedicated "Shopify Apps" category for the most popular reviews/subscription/
 * upsell/page-builder/chat apps merchants install on top of Shopify itself.
 *
 * To add a technology: add one entry to SIGNATURES. No other code changes needed.
 */

export type Category =
  | "CMS"
  | "Ecommerce"
  | "Shopify Apps"
  | "JS Framework"
  | "CSS Framework"
  | "Analytics"
  | "Tag Manager"
  | "CDN / Hosting"
  | "Web Server"
  | "Payment"
  | "Fonts"
  | "Chat / Support"
  | "Email / Marketing";

export interface Technology {
  name: string;
  category: Category;
  confidence: "high" | "medium";
  evidence: string[];
}

export interface ScanInput {
  html: string;
  headers: Record<string, string>;
  cookies: string[]; // raw Set-Cookie header values
  finalUrl: string;
}

interface Signature {
  name: string;
  category: Category;
  confidence: "high" | "medium";
  /** Substrings/regex tested against the raw HTML body (case-insensitive). */
  html?: (string | RegExp)[];
  /** Substrings tested against header names+values, e.g. "server: cloudflare". */
  headers?: { name: string; test: string | RegExp }[];
  /** Substrings tested against Set-Cookie values. */
  cookies?: (string | RegExp)[];
}

function matchAny(haystack: string, needles: (string | RegExp)[]): string[] {
  const hits: string[] = [];
  for (const needle of needles) {
    if (typeof needle === "string") {
      if (haystack.includes(needle.toLowerCase())) hits.push(needle);
    } else if (needle.test(haystack)) {
      hits.push(needle.source);
    }
  }
  return hits;
}

const SIGNATURES: Signature[] = [
  // ---------------------------------------------------------------- CMS
  {
    name: "WordPress",
    category: "CMS",
    confidence: "high",
    html: ["wp-content/", "wp-includes/", /name="generator"\s+content="wordpress/i],
  },
  {
    name: "Shopify",
    category: "CMS",
    confidence: "high",
    html: ["cdn.shopify.com", "myshopify.com", "shopify.theme"],
    headers: [{ name: "x-shopify-stage", test: /.*/ }],
  },
  {
    name: "Wix",
    category: "CMS",
    confidence: "high",
    html: ["static.wixstatic.com", "wix.com/website-builder"],
    headers: [{ name: "x-wix-request-id", test: /.*/ }],
  },
  {
    name: "Squarespace",
    category: "CMS",
    confidence: "high",
    html: ["static1.squarespace.com", /name="generator"\s+content="squarespace/i],
  },
  {
    name: "Webflow",
    category: "CMS",
    confidence: "high",
    html: ["assets-global.website-files.com", /name="generator"\s+content="webflow/i],
  },
  {
    name: "Drupal",
    category: "CMS",
    confidence: "high",
    html: ["drupal.settings", "/sites/default/files", /name="generator"\s+content="drupal/i],
  },
  {
    name: "Joomla",
    category: "CMS",
    confidence: "high",
    html: ["/media/jui/", /name="generator"\s+content="joomla/i],
  },
  {
    name: "Ghost",
    category: "CMS",
    confidence: "medium",
    html: [/name="generator"\s+content="ghost/i, "/ghost/api/"],
  },
  {
    name: "HubSpot CMS",
    category: "CMS",
    confidence: "medium",
    html: ["js.hs-scripts.com", "hs-sites.com"],
  },

  // --------------------------------------------------------- Ecommerce
  {
    name: "WooCommerce",
    category: "Ecommerce",
    confidence: "high",
    html: ["woocommerce", "wc-ajax"],
  },
  {
    name: "Magento",
    category: "Ecommerce",
    confidence: "high",
    html: ["mage.cookies", "/skin/frontend/", "magento"],
  },
  {
    name: "BigCommerce",
    category: "Ecommerce",
    confidence: "high",
    html: ["cdn11.bigcommerce.com", "bigcommerce.com/s-"],
  },

  // -------------------------------------------------------- Shopify Apps
  // Detected by each app's own script/asset domain. These are Shopify-app-
  // specific enough that a match is high-confidence even without also
  // detecting "Shopify" itself — but in practice they'll only ever appear
  // alongside it, since these apps only run on Shopify storefronts.
  {
    name: "Judge.me",
    category: "Shopify Apps",
    confidence: "high",
    html: ["judge.me", "judgeme"],
  },
  {
    name: "Loox",
    category: "Shopify Apps",
    confidence: "high",
    html: ["loox.io", "loox-reviews"],
  },
  {
    name: "Yotpo",
    category: "Shopify Apps",
    confidence: "high",
    html: ["yotpo.com", "staticw2.yotpo.com"],
  },
  {
    name: "Okendo",
    category: "Shopify Apps",
    confidence: "high",
    html: ["okendo.io"],
  },
  {
    name: "Stamped.io",
    category: "Shopify Apps",
    confidence: "high",
    html: ["stamped.io"],
  },
  {
    name: "Smile.io",
    category: "Shopify Apps",
    confidence: "high",
    html: ["smile.io", "smile-ui"],
  },
  {
    name: "Recharge",
    category: "Shopify Apps",
    confidence: "high",
    html: ["rechargepayments.com", "rechargeapps.com"],
  },
  {
    name: "Bold Subscriptions",
    category: "Shopify Apps",
    confidence: "medium",
    html: ["boldapps.net", "bold-subscriptions"],
  },
  {
    name: "Rebuy",
    category: "Shopify Apps",
    confidence: "high",
    html: ["rebuyengine.com"],
  },
  {
    name: "ReConvert",
    category: "Shopify Apps",
    confidence: "medium",
    html: ["reconvert"],
  },
  {
    name: "PageFly",
    category: "Shopify Apps",
    confidence: "high",
    html: ["pagefly.io"],
  },
  {
    name: "GemPages",
    category: "Shopify Apps",
    confidence: "high",
    html: ["gempages.net"],
  },
  {
    name: "Shogun",
    category: "Shopify Apps",
    confidence: "high",
    html: ["getshogun.com"],
  },
  {
    name: "Weglot",
    category: "Shopify Apps",
    confidence: "high",
    html: ["weglot.com"],
  },
  {
    name: "Privy",
    category: "Shopify Apps",
    confidence: "high",
    html: ["privy.com"],
  },
  {
    name: "OptiMonk",
    category: "Shopify Apps",
    confidence: "high",
    html: ["optimonk.com"],
  },
  {
    name: "Gorgias",
    category: "Shopify Apps",
    confidence: "high",
    html: ["gorgias.chat", "gorgias.com/widget"],
  },
  {
    name: "TrustPulse",
    category: "Shopify Apps",
    confidence: "medium",
    html: ["trustpulse.io"],
  },
  {
    name: "Swym Wishlist",
    category: "Shopify Apps",
    confidence: "high",
    html: ["swymrelay.com"],
  },
  {
    name: "ReferralCandy",
    category: "Shopify Apps",
    confidence: "high",
    html: ["referralcandy.com"],
  },
  {
    name: "Vitals",
    category: "Shopify Apps",
    confidence: "medium",
    html: ["vitals.co/app", "vitals-cdn"],
  },

  // ------------------------------------------------------ JS Framework
  {
    name: "Next.js",
    category: "JS Framework",
    confidence: "high",
    html: ["__next_data__", "/_next/static/"],
  },
  {
    name: "React",
    category: "JS Framework",
    confidence: "medium",
    html: ["data-reactroot", "data-reactid", "react-dom"],
  },
  {
    name: "Vue.js",
    category: "JS Framework",
    confidence: "medium",
    html: ["data-v-", /vue(\.min)?\.js/i, "__vue__"],
  },
  {
    name: "Nuxt.js",
    category: "JS Framework",
    confidence: "high",
    html: ["__nuxt__", "/_nuxt/"],
  },
  {
    name: "Angular",
    category: "JS Framework",
    confidence: "high",
    html: [/ng-version="/i, "ng-app"],
  },
  {
    name: "Svelte / SvelteKit",
    category: "JS Framework",
    confidence: "medium",
    html: ["svelte-", "/_app/immutable/"],
  },
  {
    name: "jQuery",
    category: "JS Framework",
    confidence: "medium",
    html: [/jquery(-|\.)[\d.]*(min\.)?js/i, "jquery.min.js", "jquery.js"],
  },
  {
    name: "Alpine.js",
    category: "JS Framework",
    confidence: "medium",
    html: ["x-data=", "alpinejs"],
  },

  // ----------------------------------------------------- CSS Framework
  {
    name: "Bootstrap",
    category: "CSS Framework",
    confidence: "medium",
    html: [/bootstrap(\.min)?\.css/i, /bootstrap(\.min)?\.js/i],
  },
  {
    name: "Tailwind CSS",
    category: "CSS Framework",
    confidence: "medium",
    html: ["tailwindcss", /cdn\.tailwindcss\.com/i],
  },

  // -------------------------------------------------------- Analytics
  {
    name: "Google Analytics (GA4)",
    category: "Analytics",
    confidence: "high",
    html: ["googletagmanager.com/gtag/js", /gtag\(\s*['"]config['"]/i],
  },
  {
    name: "Meta Pixel",
    category: "Analytics",
    confidence: "high",
    html: ["connect.facebook.net", "fbevents.js", "fbq('init'"],
  },
  {
    name: "Hotjar",
    category: "Analytics",
    confidence: "high",
    html: ["static.hotjar.com", "hotjar.com/c/hotjar-"],
  },
  {
    name: "Segment",
    category: "Analytics",
    confidence: "high",
    html: ["cdn.segment.com", "analytics.segment.com"],
  },
  {
    name: "Mixpanel",
    category: "Analytics",
    confidence: "medium",
    html: ["cdn.mxpnl.com", "mixpanel.com"],
  },
  {
    name: "Microsoft Clarity",
    category: "Analytics",
    confidence: "high",
    html: ["clarity.ms/tag/"],
  },

  // ------------------------------------------------------ Tag Manager
  {
    name: "Google Tag Manager",
    category: "Tag Manager",
    confidence: "high",
    html: ["googletagmanager.com/gtm.js", "googletagmanager.com/ns.html"],
  },

  // -------------------------------------------------------------- CDN
  {
    name: "Cloudflare",
    category: "CDN / Hosting",
    confidence: "high",
    headers: [
      { name: "server", test: "cloudflare" },
      { name: "cf-ray", test: /.*/ },
    ],
  },
  {
    name: "Vercel",
    category: "CDN / Hosting",
    confidence: "high",
    headers: [
      { name: "x-vercel-id", test: /.*/ },
      { name: "server", test: "vercel" },
    ],
  },
  {
    name: "Netlify",
    category: "CDN / Hosting",
    confidence: "high",
    headers: [
      { name: "x-nf-request-id", test: /.*/ },
      { name: "server", test: "netlify" },
    ],
  },
  {
    name: "Amazon CloudFront",
    category: "CDN / Hosting",
    confidence: "high",
    headers: [
      { name: "via", test: "cloudfront" },
      { name: "x-amz-cf-id", test: /.*/ },
    ],
  },
  {
    name: "Fastly",
    category: "CDN / Hosting",
    confidence: "high",
    headers: [{ name: "x-served-by", test: "fastly" }],
  },
  {
    name: "GitHub Pages",
    category: "CDN / Hosting",
    confidence: "high",
    headers: [{ name: "server", test: "github.com" }],
  },

  // -------------------------------------------------------- Web Server
  {
    name: "Nginx",
    category: "Web Server",
    confidence: "high",
    headers: [{ name: "server", test: "nginx" }],
  },
  {
    name: "Apache",
    category: "Web Server",
    confidence: "high",
    headers: [{ name: "server", test: "apache" }],
  },
  {
    name: "Microsoft IIS",
    category: "Web Server",
    confidence: "high",
    headers: [{ name: "server", test: "iis" }],
  },
  {
    name: "LiteSpeed",
    category: "Web Server",
    confidence: "high",
    headers: [{ name: "server", test: "litespeed" }],
  },
  {
    name: "PHP",
    category: "Web Server",
    confidence: "high",
    headers: [{ name: "x-powered-by", test: "php" }],
  },
  {
    name: "Express (Node.js)",
    category: "Web Server",
    confidence: "high",
    headers: [{ name: "x-powered-by", test: "express" }],
  },
  {
    name: "ASP.NET",
    category: "Web Server",
    confidence: "high",
    headers: [{ name: "x-powered-by", test: "asp.net" }],
  },

  // ---------------------------------------------------------- Payment
  {
    name: "Stripe",
    category: "Payment",
    confidence: "high",
    html: ["js.stripe.com"],
  },
  {
    name: "PayPal",
    category: "Payment",
    confidence: "high",
    html: ["paypal.com/sdk/js", "paypalobjects.com"],
  },
  {
    name: "Klarna",
    category: "Payment",
    confidence: "medium",
    html: ["klarna.com", "js.klarna.com"],
  },

  // ------------------------------------------------------------ Fonts
  {
    name: "Google Fonts",
    category: "Fonts",
    confidence: "high",
    html: ["fonts.googleapis.com", "fonts.gstatic.com"],
  },
  {
    name: "Adobe Fonts (Typekit)",
    category: "Fonts",
    confidence: "high",
    html: ["use.typekit.net"],
  },

  // ------------------------------------------------------ Chat/Support
  {
    name: "Intercom",
    category: "Chat / Support",
    confidence: "high",
    html: ["widget.intercom.io", "intercomcdn.com"],
  },
  {
    name: "Zendesk",
    category: "Chat / Support",
    confidence: "high",
    html: ["static.zdassets.com", "zendesk.com"],
  },
  {
    name: "Drift",
    category: "Chat / Support",
    confidence: "high",
    html: ["js.driftt.com"],
  },
  {
    name: "Crisp",
    category: "Chat / Support",
    confidence: "high",
    html: ["client.crisp.chat"],
  },
  {
    name: "Tawk.to",
    category: "Chat / Support",
    confidence: "high",
    html: ["embed.tawk.to"],
  },

  // ------------------------------------------------- Email / Marketing
  {
    name: "Klaviyo",
    category: "Email / Marketing",
    confidence: "high",
    html: ["klaviyo.com", "static.klaviyo.com"],
  },
  {
    name: "Mailchimp",
    category: "Email / Marketing",
    confidence: "medium",
    html: ["list-manage.com", "chimpstatic.com"],
  },
  {
    name: "Klaviyo Onsite",
    category: "Email / Marketing",
    confidence: "medium",
    html: ["a.klaviyo.com/media"],
  },
];

export function detectTechnologies(input: ScanInput): Technology[] {
  const html = input.html.toLowerCase();
  const headerEntries = Object.entries(input.headers).map(
    ([k, v]) => [k.toLowerCase(), (v || "").toLowerCase()] as [string, string]
  );
  const cookieBlob = input.cookies.join(" | ").toLowerCase();

  const results: Technology[] = [];

  for (const sig of SIGNATURES) {
    const evidence: string[] = [];

    if (sig.html) {
      evidence.push(...matchAny(html, sig.html));
    }

    if (sig.headers) {
      for (const h of sig.headers) {
        const found = headerEntries.find(([name]) => name === h.name);
        if (!found) continue;
        const [, value] = found;
        if (typeof h.test === "string") {
          if (value.includes(h.test)) evidence.push(`header ${h.name}: ${value}`);
        } else if (h.test.test(value)) {
          evidence.push(`header ${h.name}: ${value}`);
        }
      }
    }

    if (sig.cookies) {
      const hits = matchAny(cookieBlob, sig.cookies);
      if (hits.length) evidence.push(...hits.map((h) => `cookie ~ ${h}`));
    }

    if (evidence.length > 0) {
      results.push({
        name: sig.name,
        category: sig.category,
        confidence: sig.confidence,
        evidence: Array.from(new Set(evidence)).slice(0, 4),
      });
    }
  }

  // De-dupe by name (in case future signatures overlap) and sort by category then name.
  const byName = new Map<string, Technology>();
  for (const r of results) byName.set(r.name, r);

  return Array.from(byName.values()).sort((a, b) =>
    a.category === b.category ? a.name.localeCompare(b.name) : a.category.localeCompare(b.category)
  );
}
