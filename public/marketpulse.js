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
    // ChatGPT/OpenAI is the one exception: OpenAI's mark isn't in simple-
    // icons — it was pulled from that project at the brand's own request
    // (see their DISCLAIMER.md's "Removal of Brands" process), which is a
    // strong signal against hand-reproducing it from memory instead. Until
    // you supply OpenAI's actual current SVG (download it yourself from
    // openai.com/brand, which publishes official assets with usage terms,
    // and drop it in here), ChatGPT keeps the placeholder sparkle glyph.
    var AI_PROVIDERS = [
      { id: "chatgpt", name: "ChatGPT", desc: "Does it recommend you and what it says", color: "#10A37F", icon: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z" },
      { id: "claude", name: "Claude", desc: "Mentions, sentiment and sources", color: "#191919", filled: true, icon: "M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z" },
      { id: "gemini", name: "Gemini", desc: "Live AI answers", color: "#8E75B2", filled: true, icon: "M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81" },
      { id: "perplexity", name: "Perplexity", desc: "Citations and sources", color: "#1FB8CD", filled: true, icon: "M22.3977 7.0896h-2.3106V.0676l-7.5094 6.3542V.1577h-1.1554v6.1966L4.4904 0v7.0896H1.6023v10.3976h2.8882V24l6.932-6.3591v6.2005h1.1554v-6.0469l6.9318 6.1807v-6.4879h2.8882V7.0896zm-3.4657-4.531v4.531h-5.355l5.355-4.531zm-13.2862.0676 4.8691 4.4634H5.6458V2.6262zM2.7576 16.332V8.245h7.8476l-6.1149 6.1147v1.9723H2.7576zm2.8882 5.0404v-3.8852h.0001v-2.6488l5.7763-5.7764v7.0111l-5.7764 5.2993zm12.7086.0248-5.7766-5.1509V9.0618l5.7766 5.7766v6.5588zm2.8882-5.0652h-1.733v-1.9723L13.3948 8.245h7.8478v8.087z" }
    ];
    var BONUS_CHECKS = [
      { id: "seo", name: "Google ranking", desc: "Where you rank and top keywords", icon: "M3 3v18h18|M8 17V9M12 17V5M16 17v-6" },
      { id: "cwv", name: "Core Web Vitals", desc: "Speed and mobile experience", icon: "M22 12h-4l-3 9L9 3l-3 9H2" },
      { id: "techstack", name: "Tech stack", desc: "What powers the site", icon: "M16 18l6-6-6-6M8 6l-6 6 6 6" }
    ];
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
    var recentWrap = document.getElementById("mpRecent");
    var recentItems = document.getElementById("mpRecentItems");

    document.getElementById("mpChips").innerHTML = CATALOG.map(function (s) {
      return '<div class="mp-chip">' + iconSvg(s.icon, 15, 15) + s.name + "</div>";
    }).join("");

    // Both the AI-provider rows and the bonus-check rows share the same
    // row markup (icon, title+description, status badge) — only which
    // container they render into, and how their state gets driven, differs.
    function stepRow(s) {
      return '<div class="mp-step2" data-id="' + s.id + '">' +
        '<div class="ic" style="background:' + s.color_bg + ';color:' + s.color + '">' + iconSvg(s.icon, 17, 17, s.filled) + '</div>' +
        '<div class="meta"><div class="t">' + s.name + '</div><div class="d">' + s.desc + '</div></div>' +
        '<div class="status">' +
          '<span class="mp-mini-radar"><span class="r"></span><span class="s"></span><span class="c"></span></span>' +
          '<span class="txt">Done</span><span class="txt-fail">Failed</span><span class="check">✓</span><span class="cross">✕</span>' +
        '</div></div>';
    }

    aiStepsEl.innerHTML = AI_PROVIDERS.map(function (s) {
      return stepRow({ id: s.id, name: s.name, desc: s.desc, icon: s.icon, color: s.color, color_bg: s.color + "22", filled: s.filled });
    }).join("");
    var aiStepEls = {};
    Array.prototype.forEach.call(aiStepsEl.querySelectorAll(".mp-step2"), function (el) {
      aiStepEls[el.getAttribute("data-id")] = el;
    });

    bonusStepsEl.innerHTML = BONUS_CHECKS.map(function (s) {
      return stepRow({ id: s.id, name: s.name, desc: s.desc, icon: s.icon, color: "#FF8C1A", color_bg: "rgba(255,140,26,.14)" });
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

    var pendingHost = null; // set right before a scan that then hits the gate, so the modal can retry it
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

    function showGateModal(host) {
      pendingHost = host;
      overlay.classList.remove("show");
      clearInterval(streamTimer);
      gateError.style.display = "none";
      gateModal.classList.add("show");
    }
    function hideGateModal() { gateModal.classList.remove("show"); }
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
          hideGateModal();
          if (pendingHost) startScan(pendingHost);
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
      row.innerHTML =
        '<button class="mp-acc-summary" type="button" aria-expanded="false">' +
          '<span class="ic" style="background:' + iconBg + ';color:' + iconColor + '">' + iconSvg(icon, 18, 18, filled) + '</span>' +
          '<span class="meta"><span class="t">' + name + '</span><span class="d">' + desc + '</span></span>' +
          '<span class="mp-badge ' + badgeCls + '">' + badgeLabel + '</span>' +
          '<span class="mp-acc-chev">' + iconSvg("m6 9 6 6 6-6", 16, 16) + '</span>' +
        '</button>' +
        '<div class="mp-acc-body">' + bodyHtml + '</div>';
      return row;
    }
    // Toggle is delegated once on the results section rather than wired per
    // row — rows get rebuilt from scratch on every scan, a single listener
    // here avoids re-binding (and the memory-leak risk of forgetting to).
    results.addEventListener("click", function (e) {
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
      if (!pr.mentioned) return "<p>Didn't mention this business for the prompt we asked.</p>";
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

    // Ring percentage is deliberately NOT an equal split across the 4 real
    // calls. Core Web Vitals (the PageSpeed/Lighthouse audit) is consistently
    // the slowest of the four, usually by a wide margin — an equal-weighted
    // "1 of 4 done = 25%" scheme either sits at 75% for most of the wait (if
    // CWV finishes last, the common case) or misleadingly hits 100% early (if
    // it happens to finish first). Instead the ring crawls toward 90% on a
    // timer calibrated to how long CWV usually takes, then snaps to 100% the
    // moment the real /api/pagespeed call actually resolves — so it reads
    // accurately regardless of which call happens to finish last.
    var CWV_ESTIMATE_MS = 9000;

    function startScan(host) {
      pendingHost = host;
      setState("scanning");
      Object.keys(stepEls).forEach(function (id) { setStep(id, "active"); });
      Object.keys(aiStepEls).forEach(function (id) { setAiStep(id, "pending"); });
      overlay.classList.add("show");

      var domain = "https://" + host;
      var keyword = deriveKeyword(host);
      var aiPrompt = "is " + keyword + " worth it?";

      var ringV = 0;
      function renderRing(v) {
        scanRing.style.setProperty("--v", v);
        scanRingNum.textContent = v;
      }
      renderRing(0);
      ringTimer = setInterval(function () {
        ringV += (90 - ringV) * 0.06; // eases toward 90, never quite reaching it on its own
        renderRing(Math.round(ringV));
      }, CWV_ESTIMATE_MS / 45);
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

      var results4 = {};
      var gated = false;

      function call(path, body, id) {
        return fetch(API_BASE + path, {
          method: "POST",
          headers: Object.assign({ "Content-Type": "application/json" }, authHeaders()),
          body: JSON.stringify(body)
        })
          .then(function (res) { return res.json().then(function (data) { return { status: res.status, ok: res.ok, data: data }; }); })
          .then(function (r) {
            if (!r.ok && r.data && r.data.error === "gate") { gated = true; }
            results4[id] = r;
            setStep(id, r.ok ? "done" : "failed");
            if (id === "cwv") finishRing();
            return r;
          })
          .catch(function () {
            results4[id] = { ok: false, data: { error: "Network error." } };
            setStep(id, "failed");
            if (id === "cwv") finishRing();
          });
      }

      Promise.all([
        call("/api/scan", { url: domain }, "techstack"),
        // Mobile-only: marketpulse.js only ever shows one Core Web Vitals
        // result, so skip the (unused here) desktop audit — cuts this call's
        // wall-clock time roughly in half. app/page.tsx and embed.js don't
        // pass this and keep getting both, since they render both.
        call("/api/pagespeed", { url: domain, strategy: "mobile" }, "cwv"),
        call("/api/seo-rank", { domain: host, keyword: keyword }, "seo"),
        call("/api/ai-visibility", { domain: host, prompts: [aiPrompt] }, "ai")
      ]).then(function () {
        clearScanTimers();
        if (gated) {
          stream.textContent = "";
          showGateModal(host);
          return;
        }
        stream.textContent = "> report ready ✓";
        setTimeout(function () { showResults(host, results4); }, 500);
      });
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
        var row = accRow(p.id, p.icon, p.color + "22", p.color, p.name, p.desc, badge.cls, badge.label, aiRowBody(pr, aiCallFailedMsg), p.filled);
        row.style.animationDelay = (i * 55) + "ms";
        aiAccordion.appendChild(row);
      });

      // ---- "Bonus checks" accordion — the 3 non-AI real checks ----
      bonusAccordion.innerHTML = "";
      BONUS_CHECKS.forEach(function (c, i) {
        var graded = gradeOf(c.id);
        var badge = bonusBadge(c.id, graded);
        var bodyHtml = "<p><b>" + escapeHtml(graded.head) + ".</b> " + escapeHtml(graded.body) + "</p>";
        var row = accRow(c.id, c.icon, "rgba(255,140,26,.14)", "#FF8C1A", c.name, c.desc, badge.cls, badge.label, bodyHtml);
        row.style.animationDelay = ((AI_PROVIDERS.length + i) * 55) + "ms";
        bonusAccordion.appendChild(row);
      });

      results.classList.add("show");
      window.scrollTo({ top: 0 });
      // Refresh the trust strip so this scan shows up in it too — the KV
      // write is fire-and-forget server-side, so give it a beat first.
      setTimeout(loadRecentScans, 1200);
    }

    document.querySelectorAll(".mp-widget img").forEach(function (im) {
      im.addEventListener("error", function () { im.style.visibility = "hidden"; });
      if (im.complete && im.naturalWidth === 0) im.style.visibility = "hidden";
    });

    // ---- recent scans trust strip ----
    // domain/technologies both come from constrained sources server-side
    // (URL.hostname parsing and a fixed internal tech-name catalog, never
    // raw user text) so this isn't actually an injection vector today — but
    // this list is rendered to every visitor, not just the person who ran
    // the scan, so it's escaped anyway rather than relying on that staying true.
    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
      });
    }
    function formatRelativeTime(iso) {
      var then = new Date(iso).getTime();
      if (isNaN(then)) return "";
      var diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
      var min = Math.floor(diffSec / 60);
      if (min < 1) return "just now";
      if (min < 60) return min + " minute" + (min === 1 ? "" : "s") + " ago";
      var hr = Math.floor(min / 60);
      if (hr < 24) return hr + " hour" + (hr === 1 ? "" : "s") + " ago";
      var day = Math.floor(hr / 24);
      if (day < 30) return day + " day" + (day === 1 ? "" : "s") + " ago";
      var mo = Math.floor(day / 30);
      return mo + " month" + (mo === 1 ? "" : "s") + " ago";
    }
    function loadRecentScans() {
      if (!recentWrap || !recentItems) return; // stale-HTML safety, same as onIfPresent elsewhere
      fetch(API_BASE + "/api/recent-scans")
        .then(function (res) { return res.json(); })
        .then(function (data) {
          var scans = (data && data.scans) || [];
          if (!scans.length) return;
          recentItems.innerHTML = scans.map(function (s) {
            var techs = (s.technologies || []).slice(0, 3).join(", ");
            return '<div class="item"><div class="left"><span class="dom">' + escapeHtml(s.domain) + "</span>" +
              (techs ? '<span class="tech">' + escapeHtml(techs) + "</span>" : "") + "</div>" +
              '<span class="time">' + escapeHtml(formatRelativeTime(s.scannedAt)) + "</span></div>";
          }).join("");
          recentWrap.style.display = "";
        })
        .catch(function () { /* nice-to-have — fails silently, strip just stays hidden */ });
    }
    loadRecentScans();
  })();
