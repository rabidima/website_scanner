import { assertSafeUrl } from "./ssrf-guard";

// Duck-type instead of `instanceof` — see the note on UnsafeUrlError in ssrf-guard.ts.
function isUnsafeUrlError(err: unknown): err is { message: string } {
  return typeof err === "object" && err !== null && (err as any).isUnsafeUrlError === true;
}

const MAX_REDIRECTS = 5;
const MAX_BODY_BYTES = 3 * 1024 * 1024; // 3MB is plenty for a landing page's HTML
const TIMEOUT_MS = 9000;
const USER_AGENT =
  "Mozilla/5.0 (compatible; StackScanBot/1.0; +https://stackscan.app) AppleWebKit/537.36";

export interface FetchResult {
  finalUrl: string;
  statusCode: number;
  headers: Record<string, string>;
  html: string;
  cookies: string[];
}

export class ScanError extends Error {
  readonly isScanError = true as const;
  constructor(message: string, public readonly userFacing = true) {
    super(message);
    this.name = "ScanError";
  }
}

/**
 * Fetches a page safely: validates the URL (and every redirect hop) isn't pointing at
 * internal infra, caps body size so a huge response can't exhaust memory, and times out
 * so a slow/hanging target can't tie up the request indefinitely.
 */
export async function fetchSiteSafely(rawUrl: string): Promise<FetchResult> {
  let current: URL;
  try {
    current = await assertSafeUrl(rawUrl);
  } catch (err) {
    if (isUnsafeUrlError(err)) throw new ScanError(err.message);
    throw err;
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
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml",
        },
      });
    } catch (err) {
      clearTimeout(timer);
      if (controller.signal.aborted) {
        throw new ScanError("The site took too long to respond.");
      }
      throw new ScanError("Couldn't reach that site. Check the URL and try again.");
    }
    clearTimeout(timer);

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new ScanError("Redirect with no destination.");
      redirects += 1;
      if (redirects > MAX_REDIRECTS) {
        throw new ScanError("Too many redirects.");
      }
      const nextUrl = new URL(location, current);
      try {
        current = await assertSafeUrl(nextUrl.toString());
      } catch (err) {
        if (isUnsafeUrlError(err)) {
          throw new ScanError("That site redirects somewhere we won't follow.");
        }
        throw err;
      }
      continue;
    }

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    const cookies = response.headers.getSetCookie
      ? response.headers.getSetCookie()
      : [];

    const reader = response.body?.getReader();
    let html = "";
    if (reader) {
      let received = 0;
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > MAX_BODY_BYTES) {
          await reader.cancel();
          break;
        }
        html += decoder.decode(value, { stream: true });
      }
    } else {
      html = await response.text();
    }

    return {
      finalUrl: current.toString(),
      statusCode: response.status,
      headers,
      html,
      cookies,
    };
  }
}
