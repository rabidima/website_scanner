import { assertSafeUrl } from "./ssrf-guard";

export interface LlmsTxtResult {
  found: boolean;
  url: string;
  content: string | null;
  truncated: boolean;
}

const TIMEOUT_MS = 6_000;
const MAX_CHARS = 20_000;
const MAX_REDIRECTS = 3;
const USER_AGENT = "Mozilla/5.0 (compatible; StackScanBot/1.0; +https://stackscan.app)";

const emptyResult = (url: string): LlmsTxtResult => ({ found: false, url, content: null, truncated: false });

/**
 * Checks for /llms.txt at the site's root — https://llmstxt.org, an emerging
 * convention (like robots.txt, but a curated markdown summary of the site
 * meant for LLMs to read). Always checked at the domain root regardless of
 * which page path was scanned.
 *
 * IMPORTANT: this manually follows redirects and re-validates each hop with
 * assertSafeUrl, the same pattern fetch-site.ts uses. Letting `fetch` auto-
 * follow redirects here (redirect: "follow") would let a malicious or
 * compromised llms.txt response 302 our server into internal infra —
 * completely bypassing the SSRF guard. Never simplify this to auto-follow.
 */
export async function checkLlmsTxt(originUrl: string): Promise<LlmsTxtResult> {
  let current: URL;
  try {
    current = new URL("/llms.txt", originUrl);
  } catch {
    return emptyResult("");
  }

  try {
    current = await assertSafeUrl(current.toString());
  } catch {
    return emptyResult(current.toString());
  }

  let redirects = 0;

  while (true) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(current.toString(), {
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": USER_AGENT, Accept: "text/plain,text/markdown,*/*" },
      });
    } catch {
      clearTimeout(timer);
      return emptyResult(current.toString());
    }
    clearTimeout(timer);

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      redirects += 1;
      if (!location || redirects > MAX_REDIRECTS) {
        return emptyResult(current.toString());
      }
      let nextUrl: URL;
      try {
        nextUrl = await assertSafeUrl(new URL(location, current).toString());
      } catch {
        return emptyResult(current.toString());
      }
      current = nextUrl;
      continue;
    }

    if (response.status !== 200) {
      return emptyResult(current.toString());
    }

    const text = await response.text();
    const truncated = text.length > MAX_CHARS;
    return {
      found: true,
      url: current.toString(),
      content: truncated ? text.slice(0, MAX_CHARS) : text,
      truncated,
    };
  }
}
