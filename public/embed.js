    (function () {
      // API_BASE is derived from this very script's own <script src="..."> URL
      // — since this file is served BY the Vercel deployment it needs to call,
      // there's nothing to configure here. document.currentScript is only
      // valid during this script's initial synchronous execution (true for
      // both normal and `defer` scripts), so this must run before any async
      // code below.
      var API_BASE = (function () {
        var el = document.currentScript;
        if (!el || !el.src) return "";
        try { return new URL(el.src).origin; } catch (e) { return ""; }
      })();

      var CATEGORY_ORDER = [
        "CMS", "Ecommerce", "Shopify Apps", "JS Framework", "CSS Framework",
        "Analytics", "Tag Manager", "CDN / Hosting", "Web Server", "Payment",
        "Fonts", "Chat / Support", "Email / Marketing"
      ];

      var input = document.getElementById("ss-url");
      var button = document.getElementById("ss-go");
      var status = document.getElementById("ss-status");
      var errorBox = document.getElementById("ss-error");
      var botBlockBox = document.getElementById("ss-bot-block");
      var pageInfo = document.getElementById("ss-page-info");
      var llmsBox = document.getElementById("ss-llms");
      var results = document.getElementById("ss-results");
      var psiSection = document.getElementById("ss-psi");
      var psiHeading = document.getElementById("ss-psi-heading");
      var psiGoButton = document.getElementById("ss-psi-go");
      var psiStatus = document.getElementById("ss-psi-status");
      var psiErrorBox = document.getElementById("ss-psi-error");
      var psiResults = document.getElementById("ss-psi-results");
      var aiSection = document.getElementById("ss-ai");
      var aiGoButton = document.getElementById("ss-ai-go");
      var aiPromptsInput = document.getElementById("ss-ai-prompts");
      var aiStatus = document.getElementById("ss-ai-status");
      var aiErrorBox = document.getElementById("ss-ai-error");
      var aiResultsBox = document.getElementById("ss-ai-results");
      var seoSection = document.getElementById("ss-seo");
      var seoGoButton = document.getElementById("ss-seo-go");
      var seoKeywordInput = document.getElementById("ss-seo-keyword");
      var seoStatus = document.getElementById("ss-seo-status");
      var seoErrorBox = document.getElementById("ss-seo-error");
      var seoResultsBox = document.getElementById("ss-seo-results");
      var lastScannedUrl = null;

      var PROVIDER_LABELS = { openai: "ChatGPT", anthropic: "Claude", gemini: "Gemini", perplexity: "Perplexity" };

      function gaugeColor(score) {
        if (score === null) return "#5f5e5a";
        if (score >= 90) return "#2fa86b";
        if (score >= 50) return "#e0a72e";
        return "#d1443f";
      }

      function gaugeSvg(score) {
        var r = 40, c = 2 * Math.PI * r;
        var pct = score === null ? 0 : score;
        var offset = c - (pct / 100) * c;
        var color = gaugeColor(score);
        var ring = score === null ? "" :
          '<circle cx="50" cy="50" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="8" ' +
          'stroke-linecap="round" stroke-dasharray="' + c + '" stroke-dashoffset="' + offset + '" transform="rotate(-90 50 50)"></circle>';
        return '<svg viewBox="0 0 100 100" width="76" height="76">' +
          '<circle cx="50" cy="50" r="' + r + '" fill="none" stroke="#e2e2e2" stroke-width="8"></circle>' +
          ring +
          '<text x="50" y="56" text-anchor="middle" font-size="24" font-weight="600" fill="' + color + '">' + (score === null ? "—" : score) + '</text>' +
          '</svg>';
      }

      function gaugeEl(label, score) {
        var wrap = document.createElement("div");
        wrap.className = "ss-gauge";
        wrap.innerHTML = gaugeSvg(score);
        var lab = document.createElement("div");
        lab.className = "ss-gauge-label";
        lab.textContent = label;
        wrap.appendChild(lab);
        return wrap;
      }

      function ratingColor(rating) {
        if (rating === "good") return "#2fa86b";
        if (rating === "needs-improvement") return "#e0a72e";
        return "#d1443f";
      }

      function renderVitals(container, webVitals) {
        if (!webVitals || !webVitals.metrics || webVitals.metrics.length === 0) return;
        var block = document.createElement("div");
        block.className = "ss-vitals";
        var heading = document.createElement("div");
        heading.className = "ss-vitals-heading";
        heading.textContent = "Core Web Vitals ";
        var source = document.createElement("span");
        source.className = "ss-vitals-source";
        source.textContent = "(" + (webVitals.source === "field" ? "real user data" : "lab estimate") + ")";
        heading.appendChild(source);
        block.appendChild(heading);
        var row = document.createElement("div");
        row.className = "ss-vitals-row";
        webVitals.metrics.forEach(function (v) {
          var color = ratingColor(v.rating);
          var pill = document.createElement("div");
          pill.className = "ss-vital-pill";
          pill.style.borderColor = color;
          pill.innerHTML = '<span class="ss-vital-label">' + v.label + '</span><span style="color:' + color + ';font-weight:600;">' + v.value + '</span>';
          row.appendChild(pill);
        });
        block.appendChild(row);
        container.appendChild(block);
      }

      function renderOpportunities(container, opportunities) {
        if (!opportunities || opportunities.length === 0) return;
        var block = document.createElement("div");
        block.className = "ss-opp-block";
        var title = document.createElement("div");
        title.className = "ss-audit-group-title";
        title.textContent = "Top opportunities";
        block.appendChild(title);
        var list = document.createElement("ul");
        list.className = "ss-opp-list";
        opportunities.forEach(function (o) {
          var li = document.createElement("li");
          li.title = o.description || "";
          li.innerHTML = '<span>' + o.title + '</span><span class="ss-opp-savings">' + o.displaySavings + '</span>';
          list.appendChild(li);
        });
        block.appendChild(list);
        container.appendChild(block);
      }

      function renderAuditGroup(container, title, items) {
        if (!items || items.length === 0) return null;
        var group = document.createElement("div");
        var heading = document.createElement("div");
        heading.className = "ss-audit-group-title";
        heading.textContent = title;
        group.appendChild(heading);
        var list = document.createElement("ul");
        list.className = "ss-audit-list";
        items.forEach(function (a) {
          var li = document.createElement("li");
          li.title = a.description || "";
          li.textContent = a.title;
          list.appendChild(li);
        });
        group.appendChild(list);
        container.appendChild(group);
      }

      function renderFailedAudits(container, failedAudits) {
        if (!failedAudits) return;
        var block = document.createElement("div");
        block.className = "ss-audit-groups";
        renderAuditGroup(block, "Accessibility issues", failedAudits.accessibility);
        renderAuditGroup(block, "SEO issues", failedAudits.seo);
        renderAuditGroup(block, "Best practices issues", failedAudits.bestPractices);
        if (block.childNodes.length > 0) container.appendChild(block);
      }

      function renderStrategy(container, label, result) {
        var wrap = document.createElement("div");
        var lab = document.createElement("div");
        lab.className = "ss-psi-strategy-label";
        lab.textContent = label;
        wrap.appendChild(lab);
        if (result.error) {
          var err = document.createElement("div");
          err.style.cssText = "font-size:13px;color:#a12a2a;";
          err.textContent = result.error;
          wrap.appendChild(err);
        } else {
          var row = document.createElement("div");
          row.className = "ss-gauge-row";
          var s = result.scores || {};
          row.appendChild(gaugeEl("Performance", s.performance));
          row.appendChild(gaugeEl("Accessibility", s.accessibility));
          row.appendChild(gaugeEl("Best Practices", s.bestPractices));
          row.appendChild(gaugeEl("SEO", s.seo));
          wrap.appendChild(row);

          var d = result.detail;
          if (d) {
            renderVitals(wrap, d.webVitals);
            renderOpportunities(wrap, d.opportunities);
            renderFailedAudits(wrap, d.failedAudits);
          }
        }
        container.appendChild(wrap);
      }

      function showError(box, message, retryFn) {
        box.innerHTML = "";
        var msg = document.createElement("div");
        msg.textContent = message;
        box.appendChild(msg);
        var retry = document.createElement("button");
        retry.type = "button";
        retry.className = "ss-retry-btn";
        retry.textContent = "Try re-running the test";
        retry.addEventListener("click", retryFn);
        box.appendChild(retry);
        box.style.display = "block";
      }

      function setPsiButtonLoading(isLoading, label) {
        psiGoButton.disabled = isLoading;
        psiGoButton.innerHTML = "";
        if (isLoading) {
          var spin = document.createElement("span");
          spin.className = "ss-spinner";
          psiGoButton.appendChild(spin);
          psiGoButton.appendChild(document.createTextNode("Running…"));
        } else {
          psiGoButton.textContent = label;
        }
      }

      function runPageSpeed() {
        if (!lastScannedUrl) return;
        psiErrorBox.style.display = "none";
        psiResults.innerHTML = "";
        psiStatus.innerHTML = "";
        var spin = document.createElement("span");
        spin.className = "ss-spinner";
        psiStatus.appendChild(spin);
        psiStatus.appendChild(document.createTextNode("Running Lighthouse audits for mobile and desktop…"));
        setPsiButtonLoading(true);

        fetch(API_BASE + "/api/pagespeed", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: lastScannedUrl })
        })
          .then(function (res) {
            return res.json().then(function (data) { return { ok: res.ok, data: data }; });
          })
          .then(function (r) {
            setPsiButtonLoading(false, "Re-run");
            if (!r.ok) {
              psiStatus.textContent = "";
              showError(psiErrorBox, r.data.message || r.data.error || "PageSpeed diagnostics failed.", runPageSpeed);
              return;
            }
            psiStatus.textContent = "";
            renderStrategy(psiResults, "Mobile", r.data.mobile);
            renderStrategy(psiResults, "Desktop", r.data.desktop);
          })
          .catch(function () {
            setPsiButtonLoading(false, "Re-run");
            psiStatus.textContent = "";
            showError(psiErrorBox, "Network error — check ALLOWED_ORIGINS includes this store's domain.", runPageSpeed);
          });
      }

      function providerChip(result) {
        var chip = document.createElement("div");
        var label = PROVIDER_LABELS[result.provider] || result.provider;
        if (!result.configured) {
          chip.className = "ss-ai-chip";
          chip.textContent = label + " · not configured";
          return chip;
        }
        if (result.error) {
          chip.className = "ss-ai-chip errored";
          chip.title = result.error;
          chip.textContent = label + " · error";
          return chip;
        }
        if (!result.mentioned) {
          chip.className = "ss-ai-chip";
          chip.textContent = label + " · not mentioned";
          return chip;
        }
        var sentimentClass = result.sentiment || "neutral";
        chip.className = "ss-ai-chip mentioned " + sentimentClass;
        chip.title = result.snippet || "";
        chip.textContent = label + " · mentioned" + (result.sentiment ? " · " + result.sentiment : "");
        if (result.citedUrl) {
          var link = document.createElement("a");
          link.href = result.citedUrl;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = "(cited)";
          link.addEventListener("click", function (e) { e.stopPropagation(); });
          chip.appendChild(link);
        }
        return chip;
      }

      function renderAiVisibility(data) {
        aiResultsBox.innerHTML = "";
        var rates = document.createElement("div");
        rates.className = "ss-ai-rates";
        (data.mentionRates || []).forEach(function (r) {
          var pill = document.createElement("div");
          pill.className = "ss-ai-rate-pill";
          var label = document.createElement("span");
          label.className = "ss-ai-rate-label";
          label.textContent = PROVIDER_LABELS[r.provider] || r.provider;
          var value = document.createElement("span");
          value.textContent = r.queriedCount === 0 ? "not configured" : r.mentionedCount + "/" + r.queriedCount + " mentioned";
          pill.appendChild(label);
          pill.appendChild(value);
          rates.appendChild(pill);
        });
        aiResultsBox.appendChild(rates);

        (data.promptResults || []).forEach(function (pr) {
          var block = document.createElement("div");
          block.className = "ss-ai-prompt";
          var text = document.createElement("div");
          text.className = "ss-ai-prompt-text";
          text.textContent = pr.prompt;
          block.appendChild(text);
          var row = document.createElement("div");
          row.className = "ss-ai-chip-row";
          (pr.results || []).forEach(function (r) { row.appendChild(providerChip(r)); });
          block.appendChild(row);
          var errored = (pr.results || []).filter(function (r) { return r.error; });
          if (errored.length > 0) {
            var errDetails = document.createElement("div");
            errDetails.className = "ss-ai-error-details";
            errored.forEach(function (r) {
              var line = document.createElement("div");
              line.className = "ss-ai-error-detail-line";
              var strong = document.createElement("strong");
              strong.textContent = (PROVIDER_LABELS[r.provider] || r.provider) + ": ";
              line.appendChild(strong);
              line.appendChild(document.createTextNode(r.error));
              errDetails.appendChild(line);
            });
            block.appendChild(errDetails);
          }
          var mentioned = (pr.results || []).filter(function (r) { return r.mentioned && r.fullResponse; });
          if (mentioned.length > 0) {
            var mentionDetails = document.createElement("div");
            mentionDetails.className = "ss-ai-mention-details";
            mentioned.forEach(function (r) {
              var line = document.createElement("div");
              line.className = "ss-ai-mention-detail-line";
              var strong = document.createElement("strong");
              strong.textContent = (PROVIDER_LABELS[r.provider] || r.provider) + ": ";
              line.appendChild(strong);
              line.appendChild(document.createTextNode(r.fullResponse));
              mentionDetails.appendChild(line);
            });
            block.appendChild(mentionDetails);
          }
          aiResultsBox.appendChild(block);
        });
      }

      function runAiVisibility() {
        if (!lastScannedUrl) return;
        var trimmedPrompt = aiPromptsInput.value.trim();
        if (!trimmedPrompt) {
          showError(aiErrorBox, "Enter a prompt.", runAiVisibility);
          return;
        }
        var prompts = [trimmedPrompt];
        aiErrorBox.style.display = "none";
        aiResultsBox.innerHTML = "";
        aiStatus.innerHTML = "";
        var spin = document.createElement("span");
        spin.className = "ss-spinner";
        aiStatus.appendChild(spin);
        aiStatus.appendChild(document.createTextNode("Querying AI providers…"));
        aiGoButton.disabled = true;

        fetch(API_BASE + "/api/ai-visibility", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ domain: lastScannedUrl, prompts: prompts })
        })
          .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
          .then(function (r) {
            aiGoButton.disabled = false;
            aiGoButton.textContent = "Re-run";
            if (!r.ok) {
              aiStatus.textContent = "";
              showError(aiErrorBox, r.data.message || r.data.error || "AI visibility check failed.", runAiVisibility);
              return;
            }
            aiStatus.textContent = "";
            renderAiVisibility(r.data);
          })
          .catch(function () {
            aiGoButton.disabled = false;
            aiGoButton.textContent = "Re-run";
            aiStatus.textContent = "";
            showError(aiErrorBox, "Network error — check ALLOWED_ORIGINS includes this store's domain.", runAiVisibility);
          });
      }

      function renderSeoRank(data) {
        seoResultsBox.innerHTML = "";
        var badge = document.createElement("div");
        badge.className = "ss-seo-rank-badge";
        if (data.rank) {
          badge.innerHTML = "Ranked <strong>#" + data.rank + "</strong> for \"" + data.keyword + "\"";
        } else {
          badge.textContent = "Not found in the top 100 results for \"" + data.keyword + "\"";
        }
        seoResultsBox.appendChild(badge);

        if (data.knowledgeGraph) {
          var kg = data.knowledgeGraph;
          var kgCard = document.createElement("div");
          kgCard.className = "ss-seo-kg-card";
          if (kg.imageUrl) {
            var kgImg = document.createElement("img");
            kgImg.className = "ss-seo-kg-image";
            kgImg.src = kg.imageUrl;
            kgImg.alt = "";
            kgCard.appendChild(kgImg);
          }
          var kgBody = document.createElement("div");
          kgBody.className = "ss-seo-kg-body";
          var kgTitle = document.createElement("div");
          kgTitle.className = "ss-seo-kg-title";
          kgTitle.textContent = kg.title || "";
          kgBody.appendChild(kgTitle);
          if (kg.type) {
            var kgType = document.createElement("div");
            kgType.className = "ss-seo-kg-type";
            kgType.textContent = kg.type;
            kgBody.appendChild(kgType);
          }
          if (kg.description) {
            var kgDesc = document.createElement("p");
            kgDesc.className = "ss-seo-kg-desc";
            kgDesc.textContent = kg.description;
            kgBody.appendChild(kgDesc);
          }
          if (kg.website) {
            var kgSite = document.createElement("a");
            kgSite.className = "ss-seo-kg-website";
            kgSite.href = kg.website;
            kgSite.target = "_blank";
            kgSite.rel = "noopener noreferrer";
            kgSite.textContent = kg.website;
            kgBody.appendChild(kgSite);
          }
          if (kg.attributes) {
            var kgAttrs = document.createElement("div");
            kgAttrs.className = "ss-seo-kg-attrs";
            Object.keys(kg.attributes).forEach(function (k) {
              var attr = document.createElement("span");
              attr.className = "ss-seo-kg-attr";
              attr.innerHTML = "<strong>" + k + ":</strong> ";
              attr.appendChild(document.createTextNode(kg.attributes[k]));
              kgAttrs.appendChild(attr);
            });
            kgBody.appendChild(kgAttrs);
          }
          kgCard.appendChild(kgBody);
          seoResultsBox.appendChild(kgCard);
        }

        if (data.answerBox) {
          var ab = data.answerBox;
          var abBox = document.createElement("div");
          abBox.className = "ss-seo-answerbox";
          var abTitle2 = document.createElement("div");
          abTitle2.className = "ss-audit-group-title";
          abTitle2.textContent = "Featured snippet (Answer Box)";
          abBox.appendChild(abTitle2);
          if (ab.title) {
            var abHeading = document.createElement("div");
            abHeading.className = "ss-seo-answerbox-title";
            abHeading.textContent = ab.title;
            abBox.appendChild(abHeading);
          }
          if (ab.answer) {
            var abText = document.createElement("p");
            abText.className = "ss-seo-answerbox-text";
            abText.textContent = ab.answer;
            abBox.appendChild(abText);
          }
          if (ab.link) {
            var abLink = document.createElement("a");
            abLink.href = ab.link;
            abLink.target = "_blank";
            abLink.rel = "noopener noreferrer";
            abLink.textContent = ab.link;
            abBox.appendChild(abLink);
          }
          seoResultsBox.appendChild(abBox);
        }

        if (data.aiOverview) {
          var ai = data.aiOverview;
          var aiBox = document.createElement("div");
          aiBox.className = "ss-seo-ai-overview";
          var aiTitle = document.createElement("div");
          aiTitle.className = "ss-audit-group-title";
          aiTitle.textContent = "Google AI Overview";
          var aiBadge = document.createElement("span");
          aiBadge.className = "ss-seo-ai-cited-badge " + (ai.domainCited ? "ss-cited" : "ss-not-cited");
          aiBadge.textContent = ai.domainCited ? "Your domain is cited" : "Not cited";
          aiTitle.appendChild(aiBadge);
          aiBox.appendChild(aiTitle);
          if (ai.text) {
            var aiText = document.createElement("p");
            aiText.className = "ss-seo-ai-overview-text";
            aiText.textContent = ai.text;
            aiBox.appendChild(aiText);
          }
          if (ai.sources && ai.sources.length > 0) {
            var aiSources = document.createElement("div");
            aiSources.className = "ss-seo-ai-overview-sources";
            ai.sources.forEach(function (s) {
              var chip = document.createElement("a");
              chip.className = "ss-seo-ai-source-chip";
              chip.href = s.link || "#";
              chip.target = "_blank";
              chip.rel = "noopener noreferrer";
              chip.textContent = s.title || s.link;
              aiSources.appendChild(chip);
            });
            aiBox.appendChild(aiSources);
          }
          seoResultsBox.appendChild(aiBox);
        }

        if (data.topResults && data.topResults.length > 0) {
          var orgTitle = document.createElement("div");
          orgTitle.className = "ss-audit-group-title";
          orgTitle.textContent = "Top organic results";
          seoResultsBox.appendChild(orgTitle);
          var list = document.createElement("ol");
          list.className = "ss-seo-organic-list";
          data.topResults.forEach(function (r) {
            var li = document.createElement("li");
            if (r.link === data.matchedUrl) li.className = "ss-matched";
            var a = document.createElement("a");
            a.href = r.link;
            a.target = "_blank";
            a.rel = "noopener noreferrer";
            a.textContent = r.title || r.link;
            li.appendChild(a);
            var urlLine = document.createElement("span");
            urlLine.className = "ss-seo-organic-url";
            urlLine.textContent = r.link;
            li.appendChild(urlLine);
            list.appendChild(li);
          });
          seoResultsBox.appendChild(list);
        }

        var ideas = (data.relatedSearches || []).concat(data.peopleAlsoAsk || []).slice(0, 12);
        if (ideas.length > 0) {
          var ideaTitle = document.createElement("div");
          ideaTitle.className = "ss-audit-group-title";
          ideaTitle.style.marginTop = "6px";
          ideaTitle.textContent = "Keyword ideas";
          seoResultsBox.appendChild(ideaTitle);
          var chipRow = document.createElement("div");
          chipRow.className = "ss-seo-chip-row";
          ideas.forEach(function (q) {
            var chip = document.createElement("span");
            chip.className = "ss-seo-idea-chip";
            chip.textContent = q;
            chipRow.appendChild(chip);
          });
          seoResultsBox.appendChild(chipRow);
        }
      }

      function runSeoRank() {
        if (!lastScannedUrl) return;
        var keyword = seoKeywordInput.value.trim();
        if (!keyword) return;
        seoErrorBox.style.display = "none";
        seoResultsBox.innerHTML = "";
        seoStatus.innerHTML = "";
        var spin = document.createElement("span");
        spin.className = "ss-spinner";
        seoStatus.appendChild(spin);
        seoStatus.appendChild(document.createTextNode("Checking Google search results…"));
        seoGoButton.disabled = true;

        fetch(API_BASE + "/api/seo-rank", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ domain: lastScannedUrl, keyword: keyword })
        })
          .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
          .then(function (r) {
            seoGoButton.disabled = false;
            if (!r.ok) {
              seoStatus.textContent = "";
              showError(seoErrorBox, r.data.message || r.data.error || "Rank check failed.", runSeoRank);
              return;
            }
            seoStatus.textContent = "";
            renderSeoRank(r.data);
          })
          .catch(function () {
            seoGoButton.disabled = false;
            seoStatus.textContent = "";
            showError(seoErrorBox, "Network error — check ALLOWED_ORIGINS includes this store's domain.", runSeoRank);
          });
      }

      function renderPageInfo(page) {
        function row(label, value) {
          var r = document.createElement("div");
          r.className = "ss-page-row";
          var l = document.createElement("span");
          l.className = "ss-page-label";
          l.textContent = label;
          var v = document.createElement("span");
          v.className = "ss-page-value";
          if (value) {
            v.textContent = value;
          } else {
            var em = document.createElement("em");
            em.textContent = "Not found";
            v.appendChild(em);
          }
          r.appendChild(l);
          r.appendChild(v);
          return r;
        }
        pageInfo.innerHTML = "";
        pageInfo.appendChild(row("Title", page.title));
        pageInfo.appendChild(row("Description", page.description));
        pageInfo.appendChild(row("H1", page.h1));
        pageInfo.style.display = "flex";
      }

      function renderBotBlock(botBlock, finalUrl) {
        if (!botBlock || !botBlock.blocked) {
          botBlockBox.style.display = "none";
          botBlockBox.textContent = "";
          return;
        }
        var who = botBlock.vendor ? botBlock.vendor + "'s" : "this site's";
        botBlockBox.textContent = "This scan was likely blocked by " + who + " bot protection, which returned a block page instead of the real site. The title, description, H1, and any content below may reflect that block page rather than " + finalUrl + "'s actual content.";
        botBlockBox.style.display = "block";
      }

      function renderLlmsTxt(llmsTxt) {
        llmsBox.innerHTML = "";
        var card = document.createElement("div");
        card.className = "ss-llms-card";

        if (!llmsTxt || !llmsTxt.found) {
          var header0 = document.createElement("div");
          header0.className = "ss-llms-header";
          header0.innerHTML = "<h4>llms.txt</h4>";
          card.appendChild(header0);
          var empty = document.createElement("p");
          empty.className = "ss-llms-empty";
          empty.textContent = "No llms.txt found at the domain root.";
          card.appendChild(empty);
          llmsBox.appendChild(card);
          llmsBox.style.display = "block";
          return;
        }

        var expanded = true;
        var header = document.createElement("div");
        header.className = "ss-llms-header";
        var title = document.createElement("h4");
        title.textContent = "llms.txt";
        header.appendChild(title);

        var actions = document.createElement("div");
        actions.className = "ss-llms-actions";
        var link = document.createElement("a");
        link.href = llmsTxt.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "View raw";
        actions.appendChild(link);
        var toggle = document.createElement("button");
        toggle.type = "button";
        toggle.textContent = "Collapse";
        actions.appendChild(toggle);
        header.appendChild(actions);
        card.appendChild(header);

        if (llmsTxt.truncated) {
          var trunc = document.createElement("p");
          trunc.className = "ss-llms-truncated";
          trunc.textContent = "Showing the first 20,000 characters — the file is longer than that.";
          card.appendChild(trunc);
        }

        var pre = document.createElement("pre");
        pre.className = "ss-llms-content";
        pre.textContent = llmsTxt.content;
        card.appendChild(pre);

        toggle.addEventListener("click", function () {
          expanded = !expanded;
          pre.style.display = expanded ? "block" : "none";
          toggle.textContent = expanded ? "Collapse" : "Expand";
        });

        llmsBox.appendChild(card);
        llmsBox.style.display = "block";
      }

      function render(technologies) {
        results.innerHTML = "";
        var byCat = {};
        technologies.forEach(function (t) {
          (byCat[t.category] = byCat[t.category] || []).push(t.name);
        });
        CATEGORY_ORDER.forEach(function (cat) {
          if (!byCat[cat]) return;
          var card = document.createElement("div");
          card.className = "ss-card";
          var label = document.createElement("div");
          label.className = "ss-cat";
          label.textContent = cat;
          card.appendChild(label);
          var chips = document.createElement("div");
          chips.className = "ss-chips";
          byCat[cat].forEach(function (name) {
            var chip = document.createElement("span");
            chip.className = "ss-chip";
            chip.textContent = name;
            chips.appendChild(chip);
          });
          card.appendChild(chips);
          results.appendChild(card);
        });
      }

      function scan() {
        var url = input.value.trim();
        if (!url) return;
        errorBox.style.display = "none";
        botBlockBox.style.display = "none";
        pageInfo.style.display = "none";
        llmsBox.style.display = "none";
        llmsBox.innerHTML = "";
        results.innerHTML = "";
        psiSection.style.display = "none";
        psiResults.innerHTML = "";
        aiSection.style.display = "none";
        aiResultsBox.innerHTML = "";
        aiErrorBox.style.display = "none";
        seoSection.style.display = "none";
        seoResultsBox.innerHTML = "";
        seoErrorBox.style.display = "none";
        status.textContent = "Fetching the page and checking signatures…";
        button.disabled = true;

        fetch(API_BASE + "/api/scan", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: url })
        })
          .then(function (res) {
            return res.json().then(function (data) { return { ok: res.ok, data: data }; });
          })
          .then(function (r) {
            button.disabled = false;
            if (!r.ok) {
              status.textContent = "";
              showError(errorBox, r.data.message || r.data.error || "Scan failed.", scan);
              return;
            }
            status.textContent = "Scanned " + r.data.finalUrl + " · HTTP " + r.data.statusCode +
              " · " + r.data.technologies.length + " technologies detected";
            renderBotBlock(r.data.botBlock, r.data.finalUrl);
            if (r.data.page) renderPageInfo(r.data.page);
            renderLlmsTxt(r.data.llmsTxt);
            render(r.data.technologies);
            lastScannedUrl = r.data.finalUrl;
            psiHeading.textContent = "Diagnose performance issues for " + r.data.finalUrl;
            psiGoButton.textContent = "Run diagnostics";
            psiSection.style.display = "block";
            aiGoButton.textContent = "Check AI visibility";
            aiSection.style.display = "block";
            seoSection.style.display = "block";
          })
          .catch(function () {
            button.disabled = false;
            status.textContent = "";
            showError(errorBox, "Network error — check API_BASE is set correctly and ALLOWED_ORIGINS includes this store's domain.", scan);
          });
      }

      button.addEventListener("click", scan);
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") scan();
      });
      psiGoButton.addEventListener("click", runPageSpeed);
      aiGoButton.addEventListener("click", runAiVisibility);
      aiPromptsInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") runAiVisibility();
      });
      seoGoButton.addEventListener("click", runSeoRank);
      seoKeywordInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") runSeoRank();
      });
    })();
