import dns from "node:dns";

/**
 * "Legit email" gate for the free-scan-then-email-unlock flow. Three checks,
 * cheapest first so we never do a DNS lookup for an obviously-bad address:
 *   1. RFC-ish format (good enough to catch typos, not a full RFC 5322 parser)
 *   2. Not a known disposable/throwaway domain (mailinator, guerrillamail, ...)
 *   3. The domain actually has an MX record (catches typo'd domains and
 *      fake-but-well-formed addresses like asdf@asdf.com)
 *
 * Deliberately NOT doing a send-a-verification-link flow — that's the
 * "real" way to confirm an inbox is live, but it adds a full email-sending
 * dependency and a wait-for-click step to what's meant to be a frictionless
 * unlock. MX-record validation is the standard lightweight middle ground.
 */

const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

// Curated list of the most common disposable/temp-mail domains. Not
// exhaustive — new ones appear constantly — but this catches the vast
// majority of throwaway signups without pulling in an external dependency
// that needs its own update cadence. Add to this list as needed.
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.info", "guerrillamail.biz",
  "guerrillamail.de", "guerrillamail.net", "guerrillamail.org", "sharklasers.com",
  "10minutemail.com", "10minutemail.net", "20minutemail.com", "temp-mail.org",
  "tempmail.com", "tempmail.net", "tempmailo.com", "throwawaymail.com",
  "yopmail.com", "yopmail.net", "yopmail.fr", "mailnesia.com", "trashmail.com",
  "trashmail.net", "getnada.com", "maildrop.cc", "mintemail.com", "dispostable.com",
  "fakeinbox.com", "mytemp.email", "moakt.com", "mailcatch.com", "spam4.me",
  "mailtemp.info", "emailondeck.com", "mohmal.com", "tempinbox.com", "tempr.email",
  "discard.email", "discardmail.com", "spamgourmet.com", "mailnull.com",
  "email-fake.com", "mailslurp.com", "temp-mail.io", "burnermail.io",
  "inboxbear.com", "tempmailaddress.com", "getairmail.com", "harakirimail.com",
  "0-mail.com", "anonbox.net", "spambog.com", "byom.de", "kzccv.com",
]);

export type EmailValidationResult =
  | { valid: true }
  | { valid: false; reason: string };

export async function validateEmail(rawEmail: string): Promise<EmailValidationResult> {
  const email = rawEmail.trim().toLowerCase();

  if (!email) {
    return { valid: false, reason: "Enter your email address." };
  }
  if (!EMAIL_REGEX.test(email)) {
    return { valid: false, reason: "That email address doesn't look valid." };
  }

  const domain = email.split("@")[1];
  if (!domain) {
    return { valid: false, reason: "That email address doesn't look valid." };
  }

  if (DISPOSABLE_DOMAINS.has(domain)) {
    return { valid: false, reason: "Temporary or disposable email addresses aren't accepted. Use a real address." };
  }

  try {
    const records = await dns.promises.resolveMx(domain);
    if (!records || records.length === 0) {
      return { valid: false, reason: "That email domain doesn't accept mail. Check for a typo." };
    }
  } catch {
    return { valid: false, reason: "That email domain doesn't accept mail. Check for a typo." };
  }

  return { valid: true };
}
