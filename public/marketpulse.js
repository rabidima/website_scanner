  (function () {
    // API_BASE is derived from this script's own <script src="..."> URL — same
    // approach as embed.js. Nothing to configure here; just deploy this file
    // alongside the API routes and point the Liquid block's <script src> at it.
    var API_BASE = (function () {
      var el = document.currentScript;
      if (!el || !el.src) return "";
      try { return new URL(el.src).origin; } catch (e) { return ""; }
    })();

    // Verified-unlocked status is NOT a cookie. This API lives on a
    // different origin than this page, which makes cookies third-party —
    // browsers (Chrome Incognito today, everywhere soon) silently drop
    // those. Instead the token /api/lead returns is kept in localStorage
    // (first-party, always reliable) and sent back explicitly as
    // `Authorization: Bearer <token>` on every scan request.
    var TOKEN_KEY = "mp_verified_token";
    function getToken() {
      try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
    }
    function setToken(token) {
      try { localStorage.setItem(TOKEN_KEY, token); } catch (e) { /* private-mode storage denial etc — non-fatal, just won't persist */ }
    }
    function authHeaders() {
      var token = getToken();
      return token ? { Authorization: "Bearer " + token } : {};
    }

    // ---- scan catalog: 4 real, 5 coming-soon, in the visual order they render ----
    // Real entries carry an `id` used to route to the right fetch + grading logic.
    var CATALOG = [
      { name: "Traffic & visibility", icon: "M3 3v18h18|m19 9-5 5-4-4-3 3", real: false },
      { name: "Google ranking", icon: "M3 3v18h18|M8 17V9M12 17V5M16 17v-6", real: true, id: "seo" },
      { name: "Google presence & score", icon: "M12 8v4l3 2", real: false },
      { name: "Core Web Vitals", icon: "M22 12h-4l-3 9L9 3l-3 9H2", real: true, id: "cwv" },
      { name: "AI visibility", icon: "M12 2a5 5 0 0 1 5 5c0 2-1 3-1 5H8c0-2-1-3-1-5a5 5 0 0 1 5-5Z|M9 21h6M9 18h6", real: true, id: "ai" },
      { name: "Social media presence", icon: "M17 2H7a2 2 0 0 0-2 2v16l7-3 7 3V4a2 2 0 0 0-2-2Z", real: false },
      { name: "Reputation & reviews", icon: "m12 2 2.4 5 5.6.8-4 3.9 1 5.6L12 20l-5 2.6 1-5.6-4-3.9 5.6-.8Z", real: false },
      { name: "Tech stack detected", icon: "M16 18l6-6-6-6M8 6l-6 6 6 6", real: true, id: "techstack" },
      { name: "Ads & tracking", icon: "M3 4h18v14H3z|M7 20h10", real: false }
    ];
    var REAL_STEPS = CATALOG.filter(function (c) { return c.real; }); // the 4 actual fetches made per scan

    // ---- scanning-overlay display data ----
    // The overlay groups the 4 real fetches into two visual sections. "Bonus
    // checks" maps 1:1 to 3 of the 4 real API calls (seo/cwv/techstack) and
    // is driven by their actual completion, same as before. "AI visibility"
    // is a single real API call (/api/ai-visibility, id "ai") that already
    // returns all 4 providers' results in one response — there's no way to
    // know when ChatGPT-specifically finished vs. Claude-specifically. So
    // these 4 rows are decorative: each shows a small radar spin for a fixed
    // ~2s then flips to "Done", independent of when the real call actually
    // resolves. The real card on the results page always reflects the true
    // per-provider data regardless of this overlay's timing.
    //
    // Claude/Gemini/Perplexity below use each brand's real logo mark (path
    // data + official hex from simple-icons, CC0-licensed and maintained
    // specifically for reproducing brand icons like this — see
    // simpleicons.org). `filled: true` tells iconSvg() to render these as
    // solid shapes instead of the open-stroke style used by this file's
    // other, generic glyphs.
    //
    // ChatGPT/OpenAI's mark isn't in simple-icons (pulled at the brand's own
    // request), so this path was instead traced from the actual "Blossom"
    // logo file you provided, then rescaled into this file's 0-24 viewBox
    // convention and verified by re-rendering it and diffing pixel-for-pixel
    // against your source image. Rendered in OpenAI's own native black
    // (#000) rather than tinted, per their brand guidelines' explicit "DON'T
    // add any colors to the Blossom" rule — unlike the other three, which
    // use each brand's official accent color.
    var AI_PROVIDERS = [
      { id: "chatgpt", name: "ChatGPT", desc: "Does it recommend you and what it says", color: "#000000", filled: true, icon: "M14.505 2.305c.25.205.25.205.429.379v.178l.267-.089c1.701-.141 3.147.093 4.519 1.17 1.073.928 1.882 2.121 2.074 3.551.05.754.065 1.505-.129 2.239-.062.279-.077.383.062.636q.165.202.338.395c.873 1.03.987 2.525.909 3.816-.136 1.331-.836 2.607-1.804 3.516-.731.593-1.704 1.247-2.673 1.247l-.04.144c-.426 1.415-1.403 2.489-2.688 3.191-1.398.684-3.008.822-4.488.318-.836-.341-1.586-.784-2.227-1.426v-.178l-.267.089c-1.701.141-3.147-.093-4.519-1.17-1.074-.928-1.882-2.121-2.074-3.551-.051-.754-.066-1.505.128-2.238.063-.28.078-.384-.061-.637q-.165-.203-.339-.395c-.88-1.039-.974-2.526-.905-3.824.126-1.418.918-2.695 1.954-3.64.689-.552 1.609-1.115 2.519-1.115l.04-.145c.452-1.501 1.475-2.496 2.811-3.241 2.061-1.025 4.402-.617 6.164.78M7.862 3.597C6.599 4.958 6.593 6.57 6.553 8.32q-.009.508-.037 1.016c-.119 2.194-.119 2.194.302 2.746.45.385 1.091.758 1.701.758.102-.307.1-.542.101-.864v-.575l.004-.835q.007-.776.007-1.554 0-.539.005-1.08v-.411q0-.288.004-.576v-.331c.057-.278.057-.278.27-.484q.353-.229.715-.437l.282-.16.301-.171.622-.357.159-.091q.801-.46 1.596-.933l.256-.152.578-.344c-.105-.315-.209-.356-.495-.503l-.168-.081-.17-.084c-1.577-.745-3.444-.402-4.724.78m5.357 1.593-.317.179-.908.522-.243.141c-.795.46-.795.46-1.095.648-.177.102-.177.102-.414.205-.258.123-.45.23-.654.431-.109.388-.084.749-.055 1.148l.012.314q.016.383.043.765a25 25 0 0 0 1.861-1.007l.561-.329.941-.553q.424-.25.849-.497l.327-.194.462-.27.267-.156c.294-.129.472-.151.79-.112.24.104.24.104.484.249l.279.164.296.178.461.272.478.284q.616.366 1.236.73l.562.331.255.15.224.132c.18.094.18.094.358.094.314-.627.026-1.516-.178-2.138-.428-1.132-1.229-1.901-2.316-2.406-1.635-.657-3.121-.111-4.566.725M3.647 7.405c-.826.865-1.233 2.011-1.208 3.195.089 1.135.539 2.151 1.375 2.933.474.374.997.66 1.525.953q.563.318 1.121.644.577.334 1.157.665.288.169.568.348l.283.178.251.164c.246.096.246.096.522.036q.308-.135.599-.304l.176-.106.178-.109.184-.108c.445-.269.445-.269.546-.471l-.195-.111q-1.739-.987-3.469-1.993l-.257-.151-.478-.28q-.366-.216-.734-.429l-.221-.129c-.169-.114-.169-.114-.258-.292q-.015-.264-.018-.528l-.006-.335-.004-.363-.006-.371-.013-.976-.014-.996-.028-1.955c-.599 0-1.151.502-1.576.891m10.396.696-.225.122-.215.119-.197.109c-.165.112-.165.112-.343.38l.192.109q1.932 1.1 3.859 2.21c1.446.834 1.446.834 1.561 1.066q.016.263.018.527l.006.335.005.364.005.371.014.976.014.996.027 1.955c.795-.145 1.47-.707 1.96-1.337.681-1.147.995-2.233.702-3.569-.413-1.464-1.338-2.265-2.617-2.987a75 75 0 0 1-.78-.448q-.746-.433-1.495-.861l-.684-.397-.178-.103-.441-.257c-.445-.232-.788.098-1.188.321m-2.657 1.525-.3.17-.312.181-.314.18c-.763.437-.763.437-.872.544-.16.918-.27 1.95 0 2.851.526.657 1.357.986 2.138 1.247l.178.073c.283.026.454-.105.697-.244l.301-.171.311-.18.315-.18c.762-.437.762-.437.871-.545.161-.917.271-1.948 0-2.851-.525-.656-1.357-.985-2.138-1.247l-.177-.072c-.284-.027-.455.104-.698.244m3.993 1.787v.244q-.003 1.141-.011 2.281-.006.588-.007 1.173 0 .566-.006 1.132-.003.215-.002.432 0 .302-.004.604l-.002.347c-.057.291-.057.291-.269.499a19 19 0 0 1-.714.435l-.283.16-.3.171-.623.357-.158.091q-.802.46-1.596.933l-.257.152-.579.344c.105.315.21.356.496.503l.167.081.172.084c1.021.479 2.079.523 3.157.161a4.5 4.5 0 0 0 1.71-1.186l.152-.172c1.043-1.239.978-2.772 1.012-4.306q.009-.508.038-1.016c.117-2.191.117-2.191-.3-2.747-.491-.423-1.134-.757-1.793-.757m-1.541 3.561-.306.175-.329.189-.339.194q-1.443.828-2.885 1.662l-.254.145q-.206.12-.404.252c-.323.213-.575.288-.961.213-.425-.142-.797-.383-1.177-.617l-.566-.338-.294-.178q-.742-.445-1.489-.882-.138-.08-.28-.165l-.257-.151q-.112-.067-.228-.134c-.182-.095-.182-.095-.36-.095-.278.555-.082 1.335.092 1.899.406 1.129 1.065 1.948 2.132 2.519 1.108.515 2.192.526 3.346.154.526-.199 1.004-.472 1.49-.752l.316-.18.909-.522.243-.141c.795-.46.795-.46 1.095-.648.176-.102.176-.102.413-.205.259-.123.45-.23.654-.431.11-.388.085-.749.056-1.147l-.012-.315a24 24 0 0 0-.044-.765c-.192 0-.403.173-.561.264" },
      { id: "claude", name: "Claude", desc: "Mentions, sentiment and sources", color: "#191919", filled: true, icon: "M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z" },
      { id: "gemini", name: "Gemini", desc: "Live AI answers", color: "#8E75B2", filled: true, icon: "M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81" },
      { id: "perplexity", name: "Perplexity", desc: "Citations and sources", color: "#1FB8CD", filled: true, icon: "M22.3977 7.0896h-2.3106V.0676l-7.5094 6.3542V.1577h-1.1554v6.1966L4.4904 0v7.0896H1.6023v10.3976h2.8882V24l6.932-6.3591v6.2005h1.1554v-6.0469l6.9318 6.1807v-6.4879h2.8882V7.0896zm-3.4657-4.531v4.531h-5.355l5.355-4.531zm-13.2862.0676 4.8691 4.4634H5.6458V2.6262zM2.7576 16.332V8.245h7.8476l-6.1149 6.1147v1.9723H2.7576zm2.8882 5.0404v-3.8852h.0001v-2.6488l5.7763-5.7764v7.0111l-5.7764 5.2993zm12.7086.0248-5.7766-5.1509V9.0618l5.7766 5.7766v6.5588zm2.8882-5.0652h-1.733v-1.9723L13.3948 8.245h7.8478v8.087z" }
    ];
    // Order here drives the results accordion's row order — Core Web Vitals
    // sits last, after Tech stack.
    var BONUS_CHECKS = [
      { id: "seo", name: "Google ranking", desc: "Where you rank and top keywords", icon: "M3 3v18h18|M8 17V9M12 17V5M16 17v-6" },
      { id: "techstack", name: "Tech stack", desc: "What powers the site", icon: "M16 18l6-6-6-6M8 6l-6 6 6 6" },
      { id: "cwv", name: "Core Web Vitals", desc: "Speed and mobile experience", icon: "M22 12h-4l-3 9L9 3l-3 9H2" }
    ];
    // Core Web Vitals doesn't run automatically as part of the scan (the
    // PageSpeed/Lighthouse audit is consistently the slowest of the checks,
    // and not everyone needs it every time), and it doesn't appear in the
    // scanning overlay at all — it's opt-in only from its "Run check" button
    // on the results accordion, once the rest of the scan is done. See
    // buildCwvRow/runCwvCheck below. AUTO_BONUS_CHECKS is what actually runs
    // (and what the overlay's step list shows) during the automatic scan.
    var AUTO_BONUS_CHECKS = BONUS_CHECKS.filter(function (c) { return c.id !== "cwv"; });
    // AI_PROVIDERS (frontend display ids used by the scanning overlay) use
    // short brand names; lib/ai-visibility.ts's ProviderResult.provider field
    // uses the actual API/company names ("openai" for ChatGPT, "anthropic"
    // for Claude). This maps one to the other so the results accordion can
    // look up each provider's real result by the frontend id.
    var PROVIDER_ID_MAP = { chatgpt: "openai", claude: "anthropic", gemini: "gemini", perplexity: "perplexity" };
    var STREAM_LINES = {
      techstack: ["fingerprinting…", "CMS / frameworks…", "analytics tags…", "hosting / CDN…"],
      cwv: ["Lighthouse run…", "LCP / CLS / INP…", "render-blocking…", "mobile vs desktop…"],
      seo: ["SERP crawl…", "keyword positions…", "competitor overlap…", "SERP features…"],
      chatgpt: ["querying ChatGPT…"],
      claude: ["Claude check…"],
      gemini: ["Gemini check…"],
      perplexity: ["Perplexity check…", "citation share…"]
    };

    // filled=true renders a solid currentColor shape (used for real brand
    // marks, which are filled logo artwork, not line icons) instead of the
    // default open-stroke style used by the rest of this file's generic
    // Lucide-style glyphs.
    function iconSvg(icon, w, h, filled) {
      var attrs = filled ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2"';
      return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 24 24" ' + attrs + '>' +
        icon.split("|").map(function (d) { return '<path d="' + d + '"/>'; }).join("") + "</svg>";
    }

    // Google ranking / Core Web Vitals / Tech stack use pre-built artwork
    // (your supplied SVGs) instead of this file's usual single-path-string
    // convention — each has its own viewBox and, for seo/cwv, its own
    // hard-coded per-element fill colors that shouldn't be touched (Google's
    // real 4-color "G", the Core Web Vitals gauge's own palette). Tech
    // stack's source had a flat #000000 fill; that's swapped for
    // currentColor here so it still tints with this file's usual orange
    // bonus-check accent instead of rendering flat black. Keyed by the same
    // `id` used everywhere else (seo/cwv/techstack) so stepRow/accRow/chips
    // can opt a row into this rendering path with one lookup.
    var ICON_DEFS = {
      seo: {
        viewBox: "0 0 24 24",
        markup: '<path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>' +
          '<path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>' +
          '<path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>' +
          '<path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>'
      },
      cwv: {
        viewBox: "0 0 512 520.331",
        markup: '<g fill="none" fill-rule="evenodd">' +
          '<path d="M0 106.667h512v320H0z" fill="#def"/>' +
          '<path d="M512 106.667H0V42.56C0 19.055 19.137 0 42.772 0h426.456C492.85 0 512 19.032 512 42.56z" fill="#bdf"/>' +
          '<path d="M128 74.667c-11.782 0-21.333-9.552-21.333-21.334S116.217 32 128 32s21.333 9.551 21.333 21.333c0 11.782-9.55 21.334-21.333 21.334zm-74.667 0C41.551 74.667 32 65.115 32 53.333S41.551 32 53.333 32c11.782 0 21.334 9.551 21.334 21.333 0 11.782-9.552 21.334-21.334 21.334z" fill="#fff"/>' +
          '<path d="M85.333 426.667H0c0-65.516 24.994-131.033 74.98-181.02 99.975-99.974 262.065-99.974 362.04 0l-60.34 60.34C345.795 275.103 303.128 256 256 256c-94.257 0-170.667 76.41-170.667 170.667z" fill="#06f"/>' +
          '<path d="M426.667 426.667H512c0-65.516-24.994-131.033-74.98-181.02l-60.34 60.34c30.884 30.885 49.987 73.551 49.987 120.68z" fill="#c6f"/>' +
          '<path d="M195.66 487.006c-33.325-33.324-33.325-87.354 0-120.68 33.325-33.324 218.732-98.051 218.732-98.051s-64.727 185.407-98.052 218.731c-33.325 33.325-87.355 33.325-120.68 0z" fill="#6cf"/>' +
          '<path d="M256 469.333c-23.564 0-42.667-19.102-42.667-42.666C213.333 403.103 232.436 384 256 384s42.667 19.103 42.667 42.667-19.103 42.666-42.667 42.666z" fill="#06f"/>' +
          '</g>'
      },
      techstack: {
        viewBox: "0 0 490 490",
        markup: '<path d="M245.221,348.125c-56.477,0-102.424-46.162-102.424-102.903s45.947-102.904,102.424-102.904c56.476,0,102.424,46.163,102.424,102.904S301.698,348.125,245.221,348.125z M245.221,162.318c-45.449,0-82.424,37.19-82.424,82.904c0,45.713,36.975,82.903,82.424,82.903c45.449,0,82.424-37.19,82.424-82.903C327.645,199.508,290.67,162.318,245.221,162.318z"/>' +
          '<path d="M257.532,490h-0.001h-25.06c-24.58,0-44.579-20.078-44.58-44.758v-39.457c-5.296-1.908-10.519-4.091-15.625-6.532l-27.732,27.875c-8.42,8.466-19.62,13.128-31.536,13.128c-11.915,0.001-23.117-4.66-31.539-13.125l-17.721-17.814c-17.349-17.436-17.35-45.814-0.002-63.259l27.782-27.924c-2.442-5.154-4.627-10.43-6.534-15.782l-39.196-0.002c-11.919,0-23.117-4.661-31.537-13.125c-8.407-8.448-13.038-19.682-13.038-31.628v-25.192c0-24.675,19.996-44.753,44.574-44.758h39.199c1.908-5.354,4.092-10.629,6.532-15.781l-27.779-27.923c-8.407-8.449-13.039-19.683-13.039-31.629c0-11.944,4.63-23.178,13.037-31.629l17.722-17.813c8.411-8.455,19.612-13.111,31.54-13.111c11.926,0,23.126,4.655,31.538,13.109l27.733,27.876c5.104-2.439,10.327-4.623,15.624-6.53V44.757C187.892,20.078,207.889,0,232.469,0h25.06c24.581,0,44.579,20.078,44.579,44.757v39.459c5.297,1.908,10.52,4.092,15.624,6.532l27.733-27.876c8.414-8.466,19.615-13.13,31.535-13.13c11.918,0,23.12,4.663,31.542,13.131l17.718,17.806c17.349,17.438,17.35,45.817,0.004,63.262l-27.785,27.929c2.429,5.135,4.607,10.407,6.518,15.778l39.216,0.003c11.924,0,23.119,4.661,31.536,13.125c8.407,8.449,13.037,19.683,13.037,31.629l0.002,25.188c0,24.675-19.996,44.754-44.575,44.76h-39.215c-1.911,5.37-4.089,10.643-6.518,15.779l27.783,27.928c8.407,8.448,13.038,19.681,13.038,31.626c0,11.944-4.629,23.177-13.035,31.629l-17.723,17.814c-8.409,8.454-19.61,13.11-31.541,13.11c-11.927,0-23.127-4.655-31.539-13.108l-27.733-27.877c-5.105,2.441-10.327,4.624-15.622,6.53l-0.003,39.462c0.004,11.939-4.625,23.172-13.035,31.626C280.648,485.337,269.449,489.999,257.532,490z M170.307,377.165c1.595,0,3.201,0.383,4.678,1.17c8.275,4.411,16.958,8.042,25.81,10.792c4.162,1.293,6.998,5.144,6.998,9.502v46.613c0.001,13.706,11.071,24.856,24.679,24.856h25.059c6.582,0,12.772-2.579,17.431-7.263c4.672-4.697,7.245-10.943,7.243-17.588l0.003-46.621c0.001-4.358,2.836-8.209,6.999-9.502c8.849-2.749,17.531-6.379,25.803-10.789c3.873-2.063,8.64-1.349,11.736,1.763l32.826,32.995c4.647,4.671,10.838,7.244,17.43,7.244c6.594,0,12.785-2.573,17.432-7.244l17.722-17.814c4.671-4.697,7.244-10.946,7.244-17.595c0-6.648-2.573-12.895-7.245-17.59l-32.825-32.996c-3.07-3.086-3.778-7.81-1.747-11.66c4.353-8.251,7.961-16.986,10.726-25.966c1.285-4.174,5.143-7.021,9.51-7.021h46.393c13.606-0.003,24.677-11.155,24.677-24.859l-0.002-25.186c0-6.65-2.573-12.899-7.246-17.596c-4.655-4.681-10.838-7.258-17.412-7.258l-46.411-0.004c-4.367-0.001-8.223-2.849-9.509-7.021c-2.765-8.979-6.374-17.715-10.726-25.964c-2.032-3.851-1.324-8.575,1.747-11.661l32.825-32.995c9.649-9.703,9.649-25.491-0.001-35.191l-17.719-17.806c-4.661-4.687-10.852-7.266-17.433-7.266c-6.582,0-12.77,2.579-17.423,7.261l-32.831,32.999c-3.096,3.111-7.865,3.826-11.737,1.762c-8.267-4.408-16.95-8.039-25.806-10.792c-4.162-1.293-6.998-5.144-6.998-9.502V44.757c0-13.705-11.07-24.855-24.678-24.855h-25.06c-13.606,0-24.676,11.15-24.676,24.855v46.614c0,4.358-2.836,8.209-6.998,9.503c-8.856,2.751-17.539,6.382-25.808,10.79c-3.873,2.063-8.64,1.349-11.735-1.763l-32.825-32.995c-4.647-4.671-10.837-7.244-17.429-7.244c-6.592,0-12.783,2.573-17.432,7.246L77.845,94.72c-4.672,4.696-7.245,10.944-7.245,17.594c0.001,6.648,2.574,12.896,7.246,17.592L110.67,162.9c3.071,3.087,3.778,7.811,1.746,11.662c-4.384,8.306-7.998,17.04-10.743,25.961c-1.284,4.175-5.142,7.024-9.51,7.024H45.788c-13.605,0.003-24.675,11.153-24.675,24.856v25.192c0,6.649,2.573,12.896,7.245,17.592c4.659,4.682,10.846,7.261,17.422,7.261l46.383,0.002c4.368,0,8.226,2.85,9.51,7.024c2.742,8.912,6.356,17.647,10.744,25.962c2.032,3.851,1.324,8.575-1.747,11.662l-32.824,32.993c-9.649,9.702-9.65,25.489,0.001,35.188l17.72,17.814c4.659,4.683,10.85,7.261,17.431,7.261c6.581,0,12.77-2.579,17.427-7.262l32.826-32.995C165.165,378.173,167.72,377.165,170.307,377.165z" fill="currentColor"/>'
      }
    };
    function rawIconSvg(def, w, h) {
      return '<svg width="' + w + '" height="' + h + '" viewBox="' + def.viewBox + '" fill="currentColor">' + def.markup + "</svg>";
    }

    var widget = document.getElementById("mpWidget");
    var form = document.getElementById("mpScanForm");
    var input = document.getElementById("mpUrlInput");
    var overlay = document.getElementById("mpOverlay");
    var aiStepsEl = document.getElementById("mpAiSteps");
    var bonusStepsEl = document.getElementById("mpBonusSteps");
    var scanRing = document.getElementById("mpScanRing");
    var scanRingNum = document.getElementById("mpScanPct");
    var stream = document.getElementById("mpStream");
    var scanUrlEl = document.getElementById("mpScanUrl");
    var home = document.getElementById("mpHome");
    var results = document.getElementById("mpResults");
    var aiAccordion = document.getElementById("mpAiAccordion");
    var bonusAccordion = document.getElementById("mpBonusAccordion");
    var statMentioned = document.getElementById("mpStatMentioned");
    var statSentiment = document.getElementById("mpStatSentiment");
    var statSources = document.getElementById("mpStatSources");
    var gateModal = document.getElementById("mpGateModal");
    var gateForm = document.getElementById("mpGateForm");
    var gateEmail = document.getElementById("mpGateEmail");
    var gateError = document.getElementById("mpGateError");
    var upsellForm = document.getElementById("mpUpsellForm");
    var upsellEmail = document.getElementById("mpUpsellEmail");
    var upsellError = document.getElementById("mpUpsellError");
    var upsellGuarantee = document.getElementById("mpUpsellGuarantee");
    var upsellPill = document.getElementById("mpUpsellPill");
    var upsellTitle = document.getElementById("mpUpsellTitle");
    var upsellBody = document.getElementById("mpUpsellBody");
    var upsellFeat = document.getElementById("mpUpsellFeat");
    var gateTitle = document.getElementById("mpGateTitle");
    var gateBody = document.getElementById("mpGateBody");
    var urlError = document.getElementById("mpUrlError");
    var subline = document.getElementById("mpSubline");

    document.getElementById("mpChips").innerHTML = CATALOG.map(function (s) {
      var icon = ICON_DEFS[s.id] ? rawIconSvg(ICON_DEFS[s.id], 15, 15) : iconSvg(s.icon, 15, 15);
      return '<div class="mp-chip">' + icon + s.name + "</div>";
    }).join("");

    // Both the AI-provider rows and the bonus-check rows share the same
    // row markup (icon, title+description, status badge) — only which
    // container they render into, and how their state gets driven, differs.
    function stepRow(s) {
      var icon = ICON_DEFS[s.id] ? rawIconSvg(ICON_DEFS[s.id], 17, 17) : iconSvg(s.icon, 17, 17, s.filled);
      return '<div class="mp-step2" data-id="' + s.id + '">' +
        '<div class="ic" style="background:' + s.color_bg + ';color:' + s.color + '">' + icon + '</div>' +
        '<div class="meta"><div class="t">' + s.name + '</div><div class="d">' + s.desc + '</div></div>' +
        '<div class="status">' +
          '<span class="mp-mini-radar"><span class="r"></span><span class="s"></span><span class="c"></span></span>' +
          '<span class="txt">Done</span><span class="txt-fail">Failed</span><span class="check">✓</span><span class="cross">✕</span>' +
        '</div></div>';
    }

    // Icon badge background is a flat #eaf0ff across all 4 AI providers
    // (rather than each brand's own tinted color) — keeps the row scannable
    // as one visual group and matches the requested mockup; each icon's own
    // foreground color (the brand accent) is untouched.
    aiStepsEl.innerHTML = AI_PROVIDERS.map(function (s) {
      return stepRow({ id: s.id, name: s.name, desc: s.desc, icon: s.icon, color: s.color, color_bg: "#eaf0ff", filled: s.filled });
    }).join("");
    var aiStepEls = {};
    Array.prototype.forEach.call(aiStepsEl.querySelectorAll(".mp-step2"), function (el) {
      aiStepEls[el.getAttribute("data-id")] = el;
    });

    bonusStepsEl.innerHTML = AUTO_BONUS_CHECKS.map(function (s) {
      return stepRow({ id: s.id, name: s.name, desc: s.desc, icon: s.icon, color: "#FF8C1A", color_bg: "rgba(55,63,71,.04)" });
    }).join("");
    var stepEls = {};
    Array.prototype.forEach.call(bonusStepsEl.querySelectorAll(".mp-step2"), function (el) {
      stepEls[el.getAttribute("data-id")] = el;
    });

    function normalizeUrl(v) {
      v = v.trim();
      if (!v) return "";
      if (!/^https?:\/\//i.test(v)) v = "https://" + v;
      return v;
    }
    function hostOf(url) { return url.replace(/^https?:\/\//, "").replace(/\/.*$/, ""); }
    // Catches obviously-not-a-website input ("asdfasdf", "hello world", empty)
    // before we ever call the API — saves a free scan / a rate-limit hit on
    // garbage, and gives instant feedback instead of a spinner then an error.
    // Deliberately loose beyond this: real validation (DNS resolution, SSRF
    // checks) happens server-side in /api/scan, this is just a sanity filter.
    function isPlausibleWebsite(v) {
      v = v.trim();
      if (!v) return false;
      if (/\s/.test(v)) return false;
      var host = hostOf(normalizeUrl(v)).replace(/^www\./, "");
      return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(host);
    }
    function showUrlError(msg) {
      if (!urlError) return;
      urlError.textContent = msg;
      urlError.style.display = "block";
      if (subline) subline.style.display = "none";
    }
    function hideUrlError() {
      if (!urlError) return;
      urlError.style.display = "none";
      if (subline) subline.style.display = "";
    }
    // Auto-derived keyword/prompt: strip protocol + TLD, turn separators into
    // spaces. "acme-candles.com" -> "acme candles". Good enough as a sane
    // default — there's no keyword input in this flow, unlike the main widget.
    function deriveKeyword(host) {
      var noWww = host.replace(/^www\./, "");
      var noTld = noWww.replace(/\.[a-z]{2,}$/i, "");
      return noTld.replace(/[-_]+/g, " ").trim() || noWww;
    }
    function setState(s) { widget.className = "mp-widget state-" + s; }

    // Set right before showing the unlock modal, so submitting it resumes
    // exactly whatever got gated — a full scan, or just the on-demand Core
    // Web Vitals check on one accordion row. Generalized from a single
    // "pendingHost" now that there are two different things that can gate.
    var pendingGateRetry = null;
    var streamTimer = null;
    var ringTimer = null; // scan-progress ring's simulated-crawl interval
    var aiTimers = []; // AI-provider rows' decorative 2s-spin setTimeouts

    // Stops every scan-in-progress timer. Needed on cancel/home-navigation
    // so a stale timer from an abandoned scan doesn't fire later and flip a
    // row/ring that's no longer relevant (harmless since the overlay is
    // hidden by then, but wasteful, and would show stale state if the same
    // overlay markup is reused for a fresh scan started right after).
    function clearScanTimers() {
      clearInterval(streamTimer);
      clearInterval(ringTimer);
      aiTimers.forEach(function (t) { clearTimeout(t); });
      aiTimers = [];
    }

    function goHome() {
      clearScanTimers();
      overlay.classList.remove("show");
      results.classList.remove("show");
      hideGateModal();
      home.style.display = "";
      input.value = "";
      setState("home");
      window.scrollTo({ top: 0 });
    }
    // Header/nav elements (brand logo, Home button, "Run a free scan" button)
    // are optional — merchants using their theme's native header instead of
    // this widget's own full-page nav (a legitimate choice; see the install
    // comment at the top of this page's Liquid block) will have deleted the
    // <header class="mp-topbar">...</header> block entirely. Guard every
    // lookup so the rest of the widget still works when that markup is gone.
    function onIfPresent(id, event, handler) {
      var el = document.getElementById(id);
      if (el) el.addEventListener(event, handler);
    }
    onIfPresent("mpGoHomeBrand", "click", goHome);
    onIfPresent("mpGoHomeBtn", "click", goHome);
    onIfPresent("mpTryBtn", "click", function () {
      if (widget.className.indexOf("state-home") === -1) { goHome(); }
      input.focus();
    });
    document.getElementById("mpCancelBtn").addEventListener("click", function () {
      clearScanTimers();
      overlay.classList.remove("show");
      home.style.display = "";
      setState("home");
    });
    document.getElementById("mpRescanBtn").addEventListener("click", function () {
      setState("home"); results.classList.remove("show"); home.style.display = ""; input.value = ""; window.scrollTo({ top: 0 });
    });

    function showGateModal(retryFn) {
      pendingGateRetry = retryFn;
      overlay.classList.remove("show");
      clearInterval(streamTimer);
      gateError.style.display = "none";
      gateModal.classList.add("show");
    }
    function hideGateModal() { gateModal.classList.remove("show"); pendingGateRetry = null; }
    document.getElementById("mpGateModalClose").addEventListener("click", function () {
      hideGateModal();
      setState(results.classList.contains("show") ? "results" : "home");
      if (!results.classList.contains("show")) home.style.display = "";
    });

    // Pulls the expiry back out of the token itself (rather than hardcoding
    // "180 days" here too) so the displayed date always matches what the
    // server actually signed, even if that TTL ever changes.
    function decodeTokenExp(token) {
      try {
        var b64 = token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
        while (b64.length % 4) b64 += "=";
        var json = JSON.parse(decodeURIComponent(escape(atob(b64))));
        return typeof json.exp === "number" ? json.exp : null;
      } catch (e) { return null; }
    }
    function formatUnlockDate(expMs) {
      try {
        return new Date(expMs).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
      } catch (e) { return ""; }
    }

    function submitLead(email, onSuccess, onError) {
      fetch(API_BASE + "/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email })
      })
        .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
        .then(function (r) {
          if (!r.ok) { onError(r.data.message || r.data.error || "Couldn't verify that email."); return; }
          var expMs = null;
          if (r.data.token) {
            setToken(r.data.token);
            expMs = decodeTokenExp(r.data.token);
          }
          onSuccess(expMs);
        })
        .catch(function () { onError("Network error — try again in a moment."); });
    }

    gateForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = gateEmail.value.trim();
      var btn = gateForm.querySelector("button");
      btn.disabled = true;
      submitLead(
        email,
        function (expMs) {
          btn.disabled = false;
          if (gateTitle) gateTitle.textContent = "You're unlocked!";
          if (gateBody) {
            gateBody.textContent = expMs
              ? "Thanks for signing up — unlimited scans until " + formatUnlockDate(expMs) + "."
              : "Thanks for signing up — you have unlimited scans.";
          }
          var retry = pendingGateRetry;
          hideGateModal();
          if (retry) retry();
        },
        function (msg) {
          btn.disabled = false;
          gateError.textContent = msg;
          gateError.style.display = "block";
        }
      );
    });

    upsellForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = upsellEmail.value.trim();
      var btn = upsellForm.querySelector("button");
      btn.disabled = true;
      upsellError.style.display = "none";
      submitLead(
        email,
        function (expMs) {
          btn.disabled = false;
          upsellPill.textContent = "✅ YOU'RE UNLOCKED";
          if (upsellTitle) upsellTitle.textContent = "Thanks for signing up!";
          if (upsellBody) {
            upsellBody.textContent = expMs
              ? "You have unlimited scans until " + formatUnlockDate(expMs) + ". Scan any site, any time — no limits, no card required."
              : "You have unlimited scans — no limits, no card required.";
          }
          if (upsellFeat) upsellFeat.style.display = "none";
          upsellGuarantee.textContent = "Scan anything, anytime — no card, no limit.";
          upsellForm.style.display = "none";
        },
        function (msg) {
          btn.disabled = false;
          upsellError.textContent = msg;
          upsellError.style.display = "block";
        }
      );
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var val = input.value.trim();
      if (!val) { hideUrlError(); input.focus(); return; }
      if (!isPlausibleWebsite(val)) {
        showUrlError("Enter a real website, like yourbrand.com");
        input.focus();
        return;
      }
      hideUrlError();
      var url = normalizeUrl(val), host = hostOf(url);
      scanUrlEl.textContent = host;
      document.getElementById("mpResSite").innerHTML = "scan complete for <b>" + host + "</b>";
      startScan(host);
    });
    input.addEventListener("input", hideUrlError);

    // ---- grading: turns raw API numbers into the card's score/grade/copy ----
    function tierClass(score) { return score >= 70 ? "mp-g-good" : score >= 40 ? "mp-g-mid" : "mp-g-bad"; }
    function tierColor(score) { return score >= 70 ? "#12B76A" : score >= 40 ? "#F79009" : "#F04438"; }
    function letterGrade(score) { return score >= 85 ? "A" : score >= 70 ? "B" : score >= 50 ? "C" : "D"; }

    function gradeTechStack(data) {
      var n = (data.technologies || []).length;
      var score = Math.min(100, n * 8);
      var names = data.technologies.slice(0, 3).map(function (t) { return t.name; }).join(", ");
      return {
        score: score,
        head: n + " technolog" + (n === 1 ? "y" : "ies") + " detected",
        body: names ? "Including " + names + (n > 3 ? ", and more." : ".") : "Nothing identifiable from the page's markup and headers."
      };
    }
    function gradePsi(data) {
      var strat = (data.mobile && !data.mobile.error) ? data.mobile : (data.desktop && !data.desktop.error) ? data.desktop : null;
      if (!strat) return { score: 0, head: "Couldn't run", body: (data.mobile && data.mobile.error) || (data.desktop && data.desktop.error) || "PageSpeed audit failed.", failed: true };
      var perf = (strat.scores && strat.scores.performance) || 0;
      return { score: perf, head: "Performance score " + perf + "/100 (" + (strat === data.mobile ? "mobile" : "desktop") + ")", body: perf >= 90 ? "Fast — Core Web Vitals are in good shape." : perf >= 50 ? "Room to improve load speed and Web Vitals." : "Slow load — Core Web Vitals likely failing on real visitors." };
    }
    function gradeSeo(data) {
      var score = data.rank ? Math.max(15, 100 - (data.rank - 1) * 3) : 15;
      return {
        score: score,
        head: data.rank ? 'Ranked #' + data.rank + ' for "' + data.keyword + '"' : 'Not in the top 100 for "' + data.keyword + '"',
        body: (data.topResults || []).length + " organic results reviewed" + ((data.relatedSearches || []).length ? ", " + data.relatedSearches.length + " related keyword ideas found." : ".")
      };
    }
    function gradeAi(data) {
      var mentioned = 0, queried = 0;
      (data.mentionRates || []).forEach(function (r) { mentioned += r.mentionedCount || 0; queried += r.queriedCount || 0; });
      var score = queried > 0 ? Math.round((mentioned / queried) * 100) : 0;
      return {
        score: score,
        head: queried > 0 ? mentioned + "/" + queried + " AI providers mention this brand" : "No AI providers configured",
        body: queried > 0 ? (mentioned > 0 ? "Cited in at least one live AI answer." : "Not surfaced in any AI answers for this prompt yet.") : "Set at least one provider API key on the backend to run this check."
      };
    }

    // ---- results-page accordion (replaces the old always-open card grid) ----
    // Both sections (AI providers, bonus checks) share the same collapsible
    // row shell — icon, title+description, a status badge, a chevron — and
    // only the badge logic and expanded-body content differ per section.
    function accRow(id, icon, iconBg, iconColor, name, desc, badgeCls, badgeLabel, bodyHtml, filled) {
      var row = document.createElement("div");
      row.className = "mp-acc-row";
      var iconHtml = ICON_DEFS[id] ? rawIconSvg(ICON_DEFS[id], 18, 18) : iconSvg(icon, 18, 18, filled);
      row.innerHTML =
        '<button class="mp-acc-summary" type="button" aria-expanded="false">' +
          '<span class="ic" style="background:' + iconBg + ';color:' + iconColor + '">' + iconHtml + '</span>' +
          '<span class="meta"><span class="t">' + name + '</span><span class="d">' + desc + '</span></span>' +
          '<span class="mp-badge ' + badgeCls + '">' + badgeLabel + '</span>' +
          '<span class="mp-acc-chev">' + iconSvg("m6 9 6 6 6-6", 16, 16) + '</span>' +
        '</button>' +
        '<div class="mp-acc-body">' + bodyHtml + '</div>';
      return row;
    }
    // Core Web Vitals' row, before it's ever been run: a "Run check" pill
    // (styled via .mp-badge-run in place of a grade badge) instead of a
    // pre-populated result, since nothing was fetched for it during the scan.
    function buildCwvRow(host, c) {
      var row = accRow(
        c.id, c.icon, "rgba(55,63,71,.04)", "#FF8C1A", c.name, c.desc,
        "mp-badge-run", "Run check",
        "<p>Not run yet — click “Run check” above to test page speed and Core Web Vitals on mobile.</p>"
      );
      row.setAttribute("data-host", host);
      return row;
    }
    // Fires the on-demand /api/pagespeed call for one CWV row and rewrites
    // it in place once it resolves. Reuses gradePsi/bonusBadge so the final
    // state matches every other bonus-check row exactly. Gating works the
    // same as the main scan (this can be this visitor's free scan too, if
    // they didn't spend it on the bundle, or requires unlock if they did) —
    // on a gate it resumes this exact row via pendingGateRetry rather than
    // re-running the whole scan.
    function runCwvCheck(row) {
      var host = row.getAttribute("data-host");
      var badge = row.querySelector(".mp-badge-run");
      var body = row.querySelector(".mp-acc-body");
      row.classList.add("mp-cwv-loading", "open");
      var summary = row.querySelector(".mp-acc-summary");
      if (summary) summary.setAttribute("aria-expanded", "true");
      if (badge) { badge.textContent = "Running…"; badge.classList.remove("mp-badge-failed"); badge.classList.add("mp-badge-loading"); }
      if (body) body.innerHTML = "<p>Testing mobile page speed and Core Web Vitals…</p>";

      fetch(API_BASE + "/api/pagespeed", {
        method: "POST",
        headers: Object.assign({ "Content-Type": "application/json" }, authHeaders()),
        body: JSON.stringify({ url: "https://" + host, strategy: "mobile" })
      })
        .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
        .then(function (r) {
          row.classList.remove("mp-cwv-loading");
          if (!r.ok && r.data && r.data.error === "gate") {
            if (badge) { badge.textContent = "Run check"; badge.classList.remove("mp-badge-loading"); }
            if (body) body.innerHTML = "<p>Not run yet — click “Run check” above to test page speed and Core Web Vitals on mobile.</p>";
            showGateModal(function () { runCwvCheck(row); });
            return;
          }
          if (!r.ok) {
            var msg = (r.data && (r.data.message || r.data.error)) || "This check failed.";
            if (badge) { badge.textContent = "Retry"; badge.classList.remove("mp-badge-loading"); badge.classList.add("mp-badge-failed"); }
            if (body) body.innerHTML = "<p>" + escapeHtml(msg) + "</p>";
            return;
          }
          var graded = gradePsi(r.data);
          var finalBadge = bonusBadge("cwv", graded);
          if (badge) badge.outerHTML = '<span class="mp-badge ' + finalBadge.cls + '">' + finalBadge.label + "</span>";
          if (body) body.innerHTML = "<p><b>" + escapeHtml(graded.head) + ".</b> " + escapeHtml(graded.body) + "</p>";
        })
        .catch(function () {
          row.classList.remove("mp-cwv-loading");
          if (badge) { badge.textContent = "Retry"; badge.classList.remove("mp-badge-loading"); badge.classList.add("mp-badge-failed"); }
          if (body) body.innerHTML = "<p>Network error — try again.</p>";
        });
    }

    // Toggle is delegated once on the results section rather than wired per
    // row — rows get rebuilt from scratch on every scan, a single listener
    // here avoids re-binding (and the memory-leak risk of forgetting to).
    results.addEventListener("click", function (e) {
      // The CWV row's "Run check" pill sits inside the same <button> used for
      // the accordion toggle (badges can't be a nested real <button>, so it's
      // a styled span instead) — check for it first and short-circuit, or a
      // click on it would also toggle the row open/closed as a side effect.
      var runBtn = e.target.closest && e.target.closest(".mp-badge-run");
      if (runBtn) {
        e.preventDefault();
        e.stopPropagation();
        var runRow = runBtn.closest(".mp-acc-row");
        if (runRow && !runRow.classList.contains("mp-cwv-loading")) runCwvCheck(runRow);
        return;
      }
      var btn = e.target.closest && e.target.closest(".mp-acc-summary");
      if (!btn) return;
      var row = btn.closest(".mp-acc-row");
      var open = row.classList.toggle("open");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });

    // Finds one provider's result inside the /api/ai-visibility response.
    // marketpulse.js only ever sends a single prompt, so promptResults has
    // exactly one entry — but this doesn't assume that in case the prompt
    // count changes later.
    function findProviderResult(aiData, backendProvider) {
      var results = ((aiData && aiData.promptResults) || []).reduce(function (acc, pr) {
        return acc.concat(pr.results || []);
      }, []);
      return results.filter(function (r) { return r.provider === backendProvider; })[0] || null;
    }
    // Three-state badge, matching the mockup: Positive (mentioned + positive
    // sentiment), Neutral (mentioned but neutral/negative sentiment), Missed
    // (not mentioned, not configured, or errored — all "no visibility here").
    function aiSentimentBadge(pr) {
      if (!pr || !pr.configured || pr.error || !pr.mentioned) return { cls: "mp-g-bad", label: "Missed" };
      if (pr.sentiment === "positive") return { cls: "mp-g-good", label: "Positive" };
      return { cls: "mp-g-mid", label: "Neutral" };
    }
    // callFailedMsg is only set when the whole /api/ai-visibility request
    // failed (network error, gate, 500, etc.) — distinct from a single
    // provider just not being mentioned or not being configured, so each row
    // can say what actually happened instead of a misleading "not configured".
    function aiRowBody(pr, callFailedMsg) {
      if (callFailedMsg) return "<p>" + escapeHtml(callFailedMsg) + "</p>";
      if (!pr || !pr.configured) return "<p>This provider isn't configured on the backend yet.</p>";
      if (pr.error) return "<p>" + escapeHtml(pr.error) + "</p>";
      if (!pr.mentioned) {
        return "<p>Didn't mention this business for the prompt we asked.</p>" +
          (pr.fullResponse ? '<p class="src">What it said instead: ' + escapeHtml(pr.fullResponse) + "</p>" : "");
      }
      var body = "<p>" + escapeHtml(pr.fullResponse || pr.snippet || "") + "</p>";
      if (pr.citedUrl) body += '<p class="src">Source: <a href="' + escapeHtml(pr.citedUrl) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(pr.citedUrl) + "</a></p>";
      return body;
    }
    // Bonus checks reuse the same graders (gradeSeo/gradePsi/gradeTechStack)
    // that used to feed the old card grid — only the presentation changed.
    // Google ranking and Core Web Vitals get a letter grade off their score;
    // tech stack isn't really "gradeable" (it's just what we detected), so it
    // always shows an Info badge instead of forcing a grade onto it.
    function bonusBadge(id, graded) {
      if (id === "techstack") return { cls: "mp-g-soon", label: "Info" };
      return { cls: tierClass(graded.score), label: "Grade " + letterGrade(graded.score) };
    }

    function setStep(id, state) {
      var el = stepEls[id];
      if (!el) return;
      el.classList.remove("active", "done", "failed");
      el.classList.add(state);
    }
    // AI-provider rows only ever go "done" — there's no real per-provider
    // failure state to show since it's one combined API call (see the note
    // above AI_PROVIDERS for why these are decorative rather than wired to
    // the real request's lifecycle).
    function setAiStep(id, state) {
      var el = aiStepEls[id];
      if (!el) return;
      el.classList.remove("done");
      if (state === "done") el.classList.add("done");
    }

    // Ring percentage covers Stage B only (SEO + AI — see startScan below).
    // AI visibility (querying 4 LLM providers) is consistently the slower of
    // the two, usually by a wide margin — an equal-weighted "1 of 2 done =
    // 50%" scheme either sits at 50% for most of the wait or misleadingly
    // hits 100% early. Instead the ring crawls toward 90% on a timer
    // calibrated to how long that usually takes, then snaps to 100% the
    // moment both real calls actually resolve.
    var SCAN_ESTIMATE_MS = 9000;

    function startScan(host) {
      setState("scanning");
      Object.keys(stepEls).forEach(function (id) { setStep(id, "active"); });
      Object.keys(aiStepEls).forEach(function (id) { setAiStep(id, "pending"); });
      overlay.classList.add("show");
      stream.textContent = "> verifying " + host + "…";

      var domain = "https://" + host;
      var keyword = deriveKeyword(host); // still used for the Google-ranking check's search keyword
      // Uses the full website name (not the stripped keyword above) so the
      // question reads naturally and the model's answer is very likely to
      // echo the literal domain back — which lib/ai-visibility.ts's mention
      // detector always checks for directly, on top of the normalized brand
      // name. Ties the prompt's wording to something concrete and checkable
      // rather than an auto-derived, sometimes-awkward keyword.
      var websiteName = host.replace(/^www\./i, "");
      var aiPrompt = "Is " + websiteName + " legit and trustworthy?";
      var results4 = {};
      var gated = false;
      var scanPass = null;

      function call(path, body, id, extraHeaders) {
        return fetch(API_BASE + path, {
          method: "POST",
          headers: Object.assign({ "Content-Type": "application/json" }, authHeaders(), extraHeaders || {}),
          body: JSON.stringify(body)
        })
          .then(function (res) { return res.json().then(function (data) { return { status: res.status, ok: res.ok, data: data }; }); })
          .then(function (r) {
            if (!r.ok && r.data && r.data.error === "gate") { gated = true; }
            results4[id] = r;
            setStep(id, r.ok ? "done" : "failed");
            return r;
          })
          .catch(function () {
            var fallback = { status: 0, ok: false, data: { error: "Network error." } };
            results4[id] = fallback;
            setStep(id, "failed");
            return fallback; // callers that read the resolved value (Stage A below) need this, not undefined
          });
      }

      // Stage A: tech stack alone, as a fast validity gate. If the domain
      // can't even be reached there's no point burning the SEO/AI calls (or
      // this visitor's one free scan) on it — abort straight back to the
      // search box with an inline error instead of running the rest.
      call("/api/scan", { url: domain }, "techstack").then(function (r) {
        if (gated) {
          clearScanTimers();
          stream.textContent = "";
          showGateModal(function () { startScan(host); });
          return;
        }
        if (!r || !r.ok) {
          clearScanTimers();
          overlay.classList.remove("show");
          home.style.display = "";
          setState("home");
          showUrlError("Please check the URL you entered and run it again.");
          return;
        }
        // This route is always first in a scan, so it's the one that claims
        // the free-scan credit if this visitor doesn't have a verified
        // token yet. It hands back a short-lived pass so the SEO/AI calls
        // below don't each independently try (and fail) to claim their own
        // — see lib/gate.ts for why that matters.
        if (r.data && r.data.scanPass) scanPass = r.data.scanPass;
        runStageB();
      });

      function runStageB() {
        var ringV = 0;
        function renderRing(v) {
          scanRing.style.setProperty("--v", v);
          scanRingNum.textContent = v;
        }
        renderRing(0);
        ringTimer = setInterval(function () {
          ringV += (90 - ringV) * 0.06; // eases toward 90, never quite reaching it on its own
          renderRing(Math.round(ringV));
        }, SCAN_ESTIMATE_MS / 45);
        function finishRing() {
          clearInterval(ringTimer);
          renderRing(100);
        }

        // Each AI provider row spins for ~2s, staggered slightly so they don't
        // all flip at the exact same instant — purely a visual flourish, not
        // tied to when the real /api/ai-visibility call actually finishes.
        AI_PROVIDERS.forEach(function (p, i) {
          aiTimers.push(setTimeout(function () { setAiStep(p.id, "done"); }, 2000 + i * 350));
        });

        streamTimer = setInterval(function () {
          var activeBonusIds = Object.keys(stepEls).filter(function (id) { return stepEls[id].classList.contains("active"); });
          var pendingAiIds = Object.keys(aiStepEls).filter(function (id) { return !aiStepEls[id].classList.contains("done"); });
          var pool = activeBonusIds.concat(pendingAiIds);
          if (pool.length === 0) return;
          var id = pool[Math.floor(Math.random() * pool.length)];
          var lines = STREAM_LINES[id] || [];
          if (lines.length) stream.textContent = "> " + host + " · " + lines[Math.floor(Math.random() * lines.length)];
        }, 170);

        var passHeaders = scanPass ? { "X-Scan-Pass": scanPass } : {};
        Promise.all([
          call("/api/seo-rank", { domain: host, keyword: keyword }, "seo", passHeaders),
          call("/api/ai-visibility", { domain: host, prompts: [aiPrompt] }, "ai", passHeaders)
        ]).then(function () {
          finishRing();
          clearScanTimers();
          if (gated) {
            stream.textContent = "";
            showGateModal(function () { startScan(host); });
            return;
          }
          stream.textContent = "> report ready ✓";
          setTimeout(function () { showResults(host, results4); }, 500);
        });
      }
    }

    // If they unlocked on a previous visit, the token's still sitting in
    // localStorage — don't show the sales pitch again on this scan's
    // results. Signature isn't checked here (that needs the server secret),
    // this is purely cosmetic; the actual gate check server-side is what
    // matters for access.
    function currentUnlockExp() {
      var token = getToken();
      if (!token) return null;
      var exp = decodeTokenExp(token);
      return exp && Date.now() < exp ? exp : null;
    }

    function showResults(host, results4) {
      overlay.classList.remove("show");
      home.style.display = "none";
      setState("results");

      var unlockExp = currentUnlockExp();
      if (unlockExp) {
        upsellPill.textContent = "✅ YOU'RE UNLOCKED";
        if (upsellTitle) upsellTitle.textContent = "You have unlimited scans";
        if (upsellBody) upsellBody.textContent = "Unlimited scans until " + formatUnlockDate(unlockExp) + ".";
        if (upsellFeat) upsellFeat.style.display = "none";
        upsellForm.style.display = "none";
      } else {
        upsellPill.textContent = "🎉 THAT WAS YOUR FREE SCAN";
        if (upsellTitle) upsellTitle.textContent = "Scan any site, as often as you want.";
        if (upsellBody) upsellBody.textContent = "Leave your email and every future scan runs instantly — no limits, no card required. We'll also use it to let you know when new checks ship.";
        if (upsellFeat) upsellFeat.style.display = "";
        upsellForm.style.display = "";
        upsellForm.reset();
      }
      upsellGuarantee.textContent = "No card required · unsubscribe anytime";
      upsellError.style.display = "none";

      var graders = { techstack: gradeTechStack, cwv: gradePsi, seo: gradeSeo, ai: gradeAi };
      function gradeOf(id) {
        var r = results4[id];
        return r && r.ok ? graders[id](r.data) : { score: 0, head: "Couldn't complete", body: (r && r.data && (r.data.message || r.data.error)) || "This check failed.", failed: true };
      }

      // ---- hero: AI-visibility score is the primary number now (not an
      // average across all 4 checks) — this page's whole point is "how does
      // AI see this business", so that's what earns the big ring. ----
      var aiResult = results4.ai;
      var aiData = aiResult && aiResult.ok ? aiResult.data : null;
      var aiGraded = gradeOf("ai");
      var aiScore = aiGraded.score;

      var mentioned = 0, queried = 0;
      ((aiData && aiData.mentionRates) || []).forEach(function (r) { mentioned += r.mentionedCount || 0; queried += r.queriedCount || 0; });

      var title = !aiData ? "Couldn't complete the AI visibility check"
        : queried === 0 ? "No AI providers configured yet"
        : aiScore >= 70 ? "AI knows you and recommends you well."
        : aiScore >= 40 ? "AI knows you, but you're missing key mentions."
        : "AI barely knows this business exists yet.";
      var body = queried > 0
        ? "We asked " + queried + " AI assistant" + (queried === 1 ? "" : "s") + " a live question about this business — plus 3 bonus technical checks below."
        : "Set at least one AI provider API key on the backend (see .env.example) to run this check.";
      document.getElementById("mpVerdictTitle").textContent = title;
      document.getElementById("mpVerdictBody").textContent = body;

      var ring = document.getElementById("mpScoreRing"), num = document.getElementById("mpScoreNum"), v = 0;
      var iv = setInterval(function () {
        v++;
        ring.style.setProperty("--v", v);
        num.textContent = v;
        if (v >= aiScore) clearInterval(iv);
      }, 15);

      // ---- stat mini-cards ----
      var allProviderResults = AI_PROVIDERS.map(function (p) { return findProviderResult(aiData, PROVIDER_ID_MAP[p.id]); });
      statMentioned.textContent = queried > 0 ? mentioned + "/" + queried : "—";
      var mentionedResults = allProviderResults.filter(function (pr) { return pr && pr.mentioned; });
      var sentimentLabel = mentionedResults.length === 0 ? "No mentions yet"
        : mentionedResults.some(function (pr) { return pr.sentiment === "positive"; }) ? "Positive"
        : mentionedResults.some(function (pr) { return pr.sentiment === "neutral"; }) ? "Neutral"
        : "Negative";
      statSentiment.textContent = sentimentLabel;
      statSources.textContent = String(allProviderResults.filter(function (pr) { return pr && pr.citedUrl; }).length);

      // ---- "How AI sees you" accordion — one row per provider ----
      var aiCallFailedMsg = (!aiResult || !aiResult.ok)
        ? ((aiResult && aiResult.data && (aiResult.data.message || aiResult.data.error)) || "This check failed.")
        : null;
      aiAccordion.innerHTML = "";
      AI_PROVIDERS.forEach(function (p, i) {
        var pr = findProviderResult(aiData, PROVIDER_ID_MAP[p.id]);
        var badge = aiSentimentBadge(pr);
        var row = accRow(p.id, p.icon, "#eaf0ff", p.color, p.name, p.desc, badge.cls, badge.label, aiRowBody(pr, aiCallFailedMsg), p.filled);
        row.style.animationDelay = (i * 55) + "ms";
        aiAccordion.appendChild(row);
      });

      // ---- "Bonus checks" accordion — the 3 non-AI real checks ----
      // Core Web Vitals never runs automatically — its row always renders
      // via buildCwvRow's "not run yet" Run check button (BONUS_CHECKS'
      // order puts it last, after Tech stack).
      bonusAccordion.innerHTML = "";
      BONUS_CHECKS.forEach(function (c, i) {
        var row;
        if (c.id === "cwv") {
          row = buildCwvRow(host, c);
        } else {
          var graded = gradeOf(c.id);
          var badge = bonusBadge(c.id, graded);
          var bodyHtml = "<p><b>" + escapeHtml(graded.head) + ".</b> " + escapeHtml(graded.body) + "</p>";
          row = accRow(c.id, c.icon, "rgba(55,63,71,.04)", "#FF8C1A", c.name, c.desc, badge.cls, badge.label, bodyHtml);
        }
        row.style.animationDelay = ((AI_PROVIDERS.length + i) * 55) + "ms";
        bonusAccordion.appendChild(row);
      });

      results.classList.add("show");
      window.scrollTo({ top: 0 });
    }

    document.querySelectorAll(".mp-widget img").forEach(function (im) {
      im.addEventListener("error", function () { im.style.visibility = "hidden"; });
      if (im.complete && im.naturalWidth === 0) im.style.visibility = "hidden";
    });

    // escapeHtml is reused by the results accordion (aiRowBody, bonus-check
    // bodies) — provider snippets and graded copy are effectively trusted
    // (backend-generated), but this list renders to whoever ran the scan
    // and could in principle include LLM-echoed text, so it's escaped anyway
    // rather than relying on that staying true.
    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
      });
    }
  })();
