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
    var REAL_STEPS = CATALOG.filter(function (c) { return c.real; }); // overlay only tracks these 4
    var STREAM_LINES = {
      techstack: ["fingerprinting…", "CMS / frameworks…", "analytics tags…", "hosting / CDN…"],
      cwv: ["Lighthouse run…", "LCP / CLS / INP…", "render-blocking…", "mobile vs desktop…"],
      seo: ["SERP crawl…", "keyword positions…", "competitor overlap…", "SERP features…"],
      ai: ["querying ChatGPT…", "Claude check…", "Gemini check…", "citation share…"]
    };

    function iconSvg(icon, w, h) {
      return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
        icon.split("|").map(function (d) { return '<path d="' + d + '"/>'; }).join("") + "</svg>";
    }

    var widget = document.getElementById("mpWidget");
    var form = document.getElementById("mpScanForm");
    var input = document.getElementById("mpUrlInput");
    var overlay = document.getElementById("mpOverlay");
    var stepsEl = document.getElementById("mpSteps");
    var fill = document.getElementById("mpFill");
    var pct = document.getElementById("mpPct");
    var stream = document.getElementById("mpStream");
    var scanUrlEl = document.getElementById("mpScanUrl");
    var home = document.getElementById("mpHome");
    var results = document.getElementById("mpResults");
    var grid = document.getElementById("mpCardGrid");
    var gateModal = document.getElementById("mpGateModal");
    var gateForm = document.getElementById("mpGateForm");
    var gateEmail = document.getElementById("mpGateEmail");
    var gateError = document.getElementById("mpGateError");
    var upsellForm = document.getElementById("mpUpsellForm");
    var upsellEmail = document.getElementById("mpUpsellEmail");
    var upsellError = document.getElementById("mpUpsellError");
    var upsellGuarantee = document.getElementById("mpUpsellGuarantee");
    var upsellPill = document.getElementById("mpUpsellPill");

    document.getElementById("mpChips").innerHTML = CATALOG.map(function (s) {
      return '<div class="mp-chip">' + iconSvg(s.icon, 15, 15) + s.name + "</div>";
    }).join("");

    stepsEl.innerHTML = REAL_STEPS.map(function (s) {
      return '<div class="mp-step" data-id="' + s.id + '">' +
        '<div class="box"><span class="spin"></span>' +
        '<span class="tick"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="m5 12 5 5 9-11"/></svg></span>' +
        '<span class="cross"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M6 6l12 12M18 6L6 18"/></svg></span></div>' +
        '<div class="lbl">' + s.name + "</div></div>";
    }).join("");
    var stepEls = {};
    Array.prototype.forEach.call(stepsEl.querySelectorAll(".mp-step"), function (el) {
      stepEls[el.getAttribute("data-id")] = el;
    });

    function normalizeUrl(v) {
      v = v.trim();
      if (!v) return "";
      if (!/^https?:\/\//i.test(v)) v = "https://" + v;
      return v;
    }
    function hostOf(url) { return url.replace(/^https?:\/\//, "").replace(/\/.*$/, ""); }
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

    function goHome() {
      clearInterval(streamTimer);
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
      clearInterval(streamTimer);
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

    function submitLead(email, onSuccess, onError) {
      fetch(API_BASE + "/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email })
      })
        .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
        .then(function (r) {
          if (!r.ok) { onError(r.data.message || r.data.error || "Couldn't verify that email."); return; }
          if (r.data.token) setToken(r.data.token);
          onSuccess();
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
        function () {
          btn.disabled = false;
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
        function () {
          btn.disabled = false;
          upsellPill.textContent = "✅ YOU'RE UNLOCKED";
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
      if (!val) { input.focus(); return; }
      var url = normalizeUrl(val), host = hostOf(url);
      scanUrlEl.textContent = url;
      document.getElementById("mpResSite").innerHTML = "scan complete for <b>" + host + "</b>";
      startScan(host);
    });

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

    function scoreRing(container, score) {
      var wrap = document.createElement("div"); wrap.className = "bar";
      var i = document.createElement("i"); i.style.width = score + "%"; i.style.background = tierColor(score);
      wrap.appendChild(i); container.appendChild(wrap);
    }

    function realCard(catalogEntry, graded) {
      var card = document.createElement("div"); card.className = "mp-card";
      var color = tierColor(graded.score);
      card.innerHTML =
        '<div class="accent" style="background:' + color + '"></div>' +
        '<div class="top"><div class="icon">' + iconSvg(catalogEntry.icon, 20, 20) + '</div>' +
        '<span class="grade ' + tierClass(graded.score) + '">' + letterGrade(graded.score) + "</span></div>" +
        "<h4>" + catalogEntry.name + "</h4>" +
        "<p><b>" + graded.head + ".</b> " + graded.body + "</p>";
      scoreRing(card, graded.score);
      return card;
    }
    function comingSoonCard(catalogEntry) {
      var card = document.createElement("div"); card.className = "mp-card locked";
      card.innerHTML =
        '<div class="accent" style="background:#c7d0e0"></div>' +
        '<div class="top"><div class="icon">' + iconSvg(catalogEntry.icon, 20, 20) + '</div>' +
        '<span class="grade mp-g-soon">Soon</span></div>' +
        "<h4>" + catalogEntry.name + "</h4>" +
        "<p>This check is on our roadmap — not part of your report yet.</p>";
      return card;
    }

    function setStep(id, state) {
      var el = stepEls[id];
      if (!el) return;
      el.classList.remove("active", "done", "failed");
      el.classList.add(state);
    }

    function startScan(host) {
      pendingHost = host;
      setState("scanning");
      Object.keys(stepEls).forEach(function (id) { setStep(id, "active"); });
      fill.style.width = "0%";
      overlay.classList.add("show");

      var domain = "https://" + host;
      var keyword = deriveKeyword(host);
      var aiPrompt = "is " + keyword + " worth it?";

      var completed = 0;
      var total = REAL_STEPS.length;
      function tickProgress() {
        completed++;
        var p = Math.round((completed / total) * 100);
        fill.style.width = p + "%";
        pct.textContent = p + "% · " + (completed < total ? "analyzing…" : "compiling report…");
      }

      streamTimer = setInterval(function () {
        var activeIds = Object.keys(stepEls).filter(function (id) { return stepEls[id].classList.contains("active"); });
        if (activeIds.length === 0) return;
        var id = activeIds[Math.floor(Math.random() * activeIds.length)];
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
            tickProgress();
            return r;
          })
          .catch(function () {
            results4[id] = { ok: false, data: { error: "Network error." } };
            setStep(id, "failed");
            tickProgress();
          });
      }

      Promise.all([
        call("/api/scan", { url: domain }, "techstack"),
        call("/api/pagespeed", { url: domain }, "cwv"),
        call("/api/seo-rank", { domain: host, keyword: keyword }, "seo"),
        call("/api/ai-visibility", { domain: host, prompts: [aiPrompt] }, "ai")
      ]).then(function () {
        clearInterval(streamTimer);
        if (gated) {
          stream.textContent = "";
          showGateModal(host);
          return;
        }
        stream.textContent = "> report ready ✓";
        setTimeout(function () { showResults(host, results4); }, 500);
      });
    }

    function showResults(host, results4) {
      overlay.classList.remove("show");
      home.style.display = "none";
      setState("results");
      upsellPill.textContent = "🎉 THAT WAS YOUR FREE SCAN";
      upsellGuarantee.textContent = "No card required · unsubscribe anytime";
      upsellForm.style.display = "";
      upsellForm.reset();
      upsellError.style.display = "none";

      var graders = { techstack: gradeTechStack, cwv: gradePsi, seo: gradeSeo, ai: gradeAi };
      var scores = [];
      grid.innerHTML = "";
      CATALOG.forEach(function (entry, i) {
        var el;
        if (entry.real) {
          var r = results4[entry.id];
          var graded = r && r.ok ? graders[entry.id](r.data) : { score: 0, head: "Couldn't complete", body: (r && r.data && (r.data.message || r.data.error)) || "This check failed." };
          scores.push(graded.score);
          el = realCard(entry, graded);
        } else {
          el = comingSoonCard(entry);
        }
        el.style.animationDelay = (i * 55) + "ms";
        grid.appendChild(el);
      });

      var overall = scores.length ? Math.round(scores.reduce(function (a, b) { return a + b; }, 0) / scores.length) : 0;
      var title = overall >= 70 ? "Strong presence — keep the momentum" : overall >= 40 ? "Solid foundation — real opportunities to fix" : "Multiple issues holding this site back";
      var body = "We ran 4 live checks (tech stack, Core Web Vitals, Google ranking, AI visibility) — 5 more are on the way. Full breakdown below.";
      document.getElementById("mpVerdictTitle").textContent = title;
      document.getElementById("mpVerdictBody").textContent = body;

      var ring = document.getElementById("mpScoreRing"), num = document.getElementById("mpScoreNum"), v = 0;
      var iv = setInterval(function () {
        v++;
        ring.style.setProperty("--v", v);
        num.textContent = v;
        if (v >= overall) clearInterval(iv);
      }, 15);

      results.classList.add("show");
      window.scrollTo({ top: 0 });
    }

    document.querySelectorAll(".mp-widget img").forEach(function (im) {
      im.addEventListener("error", function () { im.style.visibility = "hidden"; });
      if (im.complete && im.naturalWidth === 0) im.style.visibility = "hidden";
    });
  })();
