/**
 * Offline test for lib/email-validate.ts. Mocks dns.promises.resolveMx via
 * Node's dns module (no real network lookups needed for format/disposable
 * cases; the MX-check cases mock the module).
 * Run with: npx tsx scripts/test-email-validate.mts
 */
import dns from "node:dns";
import { validateEmail } from "../lib/email-validate";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  console.log(`${cond ? "PASS" : "FAIL"} — ${label}${detail ? ` (${detail})` : ""}`);
  if (!cond) failures++;
}

const realResolveMx = dns.promises.resolveMx;
function mockResolveMx(fn: (domain: string) => Promise<{ exchange: string; priority: number }[]>) {
  // @ts-expect-error test-only override
  dns.promises.resolveMx = fn;
}

async function run() {
  // Case 1: obviously malformed — rejected before any DNS lookup happens.
  const noAt = await validateEmail("not-an-email");
  check("Rejects missing @", !noAt.valid);

  const noDomain = await validateEmail("person@");
  check("Rejects missing domain", !noDomain.valid);

  const empty = await validateEmail("   ");
  check("Rejects empty input", !empty.valid);

  // Case 2: disposable domain — rejected before any DNS lookup.
  const disposable = await validateEmail("someone@mailinator.com");
  check("Rejects known disposable domain", !disposable.valid, disposable.valid ? "" : disposable.reason);

  // Case 3: well-formed, non-disposable, but domain has no MX records.
  mockResolveMx(async () => {
    const err: any = new Error("ENOTFOUND");
    err.code = "ENOTFOUND";
    throw err;
  });
  const noMx = await validateEmail("person@this-domain-does-not-exist-xyz123.com");
  check("Rejects domain with no MX records", !noMx.valid, noMx.valid ? "" : noMx.reason);

  // Case 4: well-formed, non-disposable, valid MX — accepted.
  mockResolveMx(async () => [{ exchange: "mail.example.com", priority: 10 }]);
  const good = await validateEmail("Person@Example.com");
  check("Accepts a well-formed address with valid MX", good.valid);

  // Case 5: mixed-case disposable domain still caught (domain is
  // lowercased before the blocklist check).
  const mixedCaseDisposable = await validateEmail("someone@MailInator.COM");
  check("Disposable check is case-insensitive", !mixedCaseDisposable.valid);

  dns.promises.resolveMx = realResolveMx;

  console.log(`\n${failures === 0 ? "All email-validate cases passed." : `${failures} case(s) failed.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

run();
