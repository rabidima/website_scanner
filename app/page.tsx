"use client";

import { useState } from "react";
import type { Category, Technology } from "@/lib/detect";

interface PageInfo {
  title: string | null;
  description: string | null;
  h1: string | null;
}

interface ScanResponse {
  requestedUrl: string;
  finalUrl: string;
  statusCode: number;
  scannedAt: string;
  technologies: Technology[];
  page: PageInfo;
  meta: { server: string | null; poweredBy: string | null };
}

const CATEGORY_ORDER: Category[] = [
  "CMS",
  "Ecommerce",
  "Shopify Apps",
  "JS Framework",
  "CSS Framework",
  "Analytics",
  "Tag Manager",
  "CDN / Hosting",
  "Web Server",
  "Payment",
  "Fonts",
  "Chat / Support",
  "Email / Marketing",
];

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResponse | null>(null);

  async function handleScan(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || loading) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Scan failed.");
      } else {
        setResult(data);
      }
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  }

  const grouped = result
    ? CATEGORY_ORDER.map((cat) => ({
        category: cat,
        items: result.technologies.filter((t) => t.category === cat),
      })).filter((g) => g.items.length > 0)
    : [];

  return (
    <div className="page">
      <div className="hero">
        <h1>What&apos;s that site built with?</h1>
        <p>Paste a URL and get a plain-English read on its visible tech stack — CMS, frameworks, analytics, hosting, and more.</p>
      </div>

      <form className="scan-form" onSubmit={handleScan}>
        <input
          type="text"
          placeholder="example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={loading}
          autoFocus
        />
        <button type="submit" disabled={loading}>
          {loading ? "Scanning…" : "Scan"}
        </button>
      </form>

      {error && <div className="error-banner">{error}</div>}

      {loading && <div className="loading">Fetching the page and checking signatures…</div>}

      {result && (
        <>
          <div className="summary">
            Scanned <code>{result.finalUrl}</code> · HTTP {result.statusCode} ·{" "}
            {result.technologies.length} technolog{result.technologies.length === 1 ? "y" : "ies"} detected
          </div>

          <div className="page-info-card">
            <div className="page-info-row">
              <span className="page-info-label">Title</span>
              <span className="page-info-value">{result.page.title ?? <em>Not found</em>}</span>
            </div>
            <div className="page-info-row">
              <span className="page-info-label">Description</span>
              <span className="page-info-value">{result.page.description ?? <em>Not found</em>}</span>
            </div>
            <div className="page-info-row">
              <span className="page-info-label">H1</span>
              <span className="page-info-value">{result.page.h1 ?? <em>Not found</em>}</span>
            </div>
          </div>

          <div className="results">
            {grouped.length === 0 && (
              <div className="empty-state">
                No signatures matched. The site may be minified, behind heavy obfuscation, or use tech outside our current signature set.
              </div>
            )}
            {grouped.map((g) => (
              <div className="category-card" key={g.category}>
                <h2>{g.category}</h2>
                <div className="tech-list">
                  {g.items.map((t) => (
                    <div className={`tech-chip ${t.confidence}`} key={t.name} title={t.evidence.join(", ")}>
                      <span className="dot" />
                      <span className="name">{t.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <footer>StackScan MVP — detects visible tech only, not internal or server-side-only tooling.</footer>
    </div>
  );
}
