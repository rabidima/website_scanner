import * as cheerio from "cheerio";

export interface PageInfo {
  title: string | null;
  description: string | null;
  h1: string | null;
}

const MAX_LEN = 300; // defensive cap — some pages stuff absurdly long strings here

function clean(value: string | undefined | null): string | null {
  if (!value) return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_LEN ? trimmed.slice(0, MAX_LEN).trim() + "…" : trimmed;
}

/**
 * Pulls the title, meta description, and first H1 out of a page — the basics
 * anyone doing a quick SEO/content check on a site wants alongside the tech
 * stack. Uses cheerio (already a dependency) rather than regex against raw
 * HTML, since title/meta content can contain nested markup, entities, and
 * attribute-quoting variations that regex handles unreliably.
 */
export function extractPageInfo(html: string): PageInfo {
  const $ = cheerio.load(html);

  const title = clean($("title").first().text());

  const description = clean(
    $('meta[name="description" i]').attr("content") ||
      $('meta[property="og:description" i]').attr("content")
  );

  const h1 = clean($("h1").first().text());

  return { title, description, h1 };
}
