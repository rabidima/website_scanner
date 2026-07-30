/**
 * SSRF guard: this app fetches whatever URL a stranger types in, from our server.
 * Without this, someone points the scanner at http://169.254.169.254/ (cloud metadata),
 * http://localhost:6379 (internal redis), or an internal IP and uses us as a proxy into
 * our own infra. We resolve the hostname ourselves and reject private/reserved ranges
 * before ever issuing the real request, and re-check on every redirect hop.
 */
import dns from "node:dns/promises";
import net from "node:net";

const BLOCKED_HOSTNAMES = new Set(["localhost", "0.0.0.0"]);

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return false;
  const [a, b] = parts;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local incl. cloud metadata 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 0) return true; // 0.0.0.0/8
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1") return true; // loopback
  if (lower.startsWith("fe80:")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local (fc00::/7)
  if (lower.startsWith("::ffff:")) {
    // IPv4-mapped IPv6 address, e.g. ::ffff:127.0.0.1
    return isPrivateIPv4(lower.replace("::ffff:", ""));
  }
  return false;
}

export function isPrivateIP(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (net.isIPv6(ip)) return isPrivateIPv6(ip);
  return true; // unrecognized format: fail closed
}

export class UnsafeUrlError extends Error {
  // Bundlers can end up with duplicate copies of this class across chunks
  // (route handler vs. shared lib), which breaks `instanceof` checks at the
  // catch site. This marker lets callers duck-type instead.
  readonly isUnsafeUrlError = true as const;
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

/**
 * Validates a URL is safe to fetch server-side: http(s) only, resolvable, and every
 * resolved address is public. Throws UnsafeUrlError if not. Call this again after
 * following each redirect, since the redirect target could point somewhere new.
 */
export async function assertSafeUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError("That doesn't look like a valid URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError("Only http and https URLs are supported.");
  }

  const hostname = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new UnsafeUrlError("That host isn't scannable.");
  }

  // If the hostname is already a literal IP, check it directly.
  if (net.isIP(hostname)) {
    if (isPrivateIP(hostname)) {
      throw new UnsafeUrlError("That host isn't scannable.");
    }
    return url;
  }

  let addresses: string[];
  try {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    addresses = records.map((r) => r.address);
  } catch {
    throw new UnsafeUrlError("Couldn't resolve that domain.");
  }

  if (addresses.length === 0 || addresses.some(isPrivateIP)) {
    throw new UnsafeUrlError("That host isn't scannable.");
  }

  return url;
}
