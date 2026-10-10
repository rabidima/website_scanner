/**
 * Offline test for lib/shopify.ts. Mocks global.fetch for both the OAuth
 * token endpoint and the GraphQL Admin API endpoint.
 * Run with: npx tsx scripts/test-shopify.mts
 */
process.env.SHOPIFY_SHOP_DOMAIN = "test-store.myshopify.com";
process.env.SHOPIFY_CLIENT_ID = "test-client-id";
process.env.SHOPIFY_CLIENT_SECRET = "test-client-secret";

const { recordLead } = await import("../lib/shopify");

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  console.log(`${cond ? "PASS" : "FAIL"} — ${label}${detail ? ` (${detail})` : ""}`);
  if (!cond) failures++;
}

const realFetch = global.fetch;
let tokenRequestCount = 0;
let graphqlBodies: any[] = [];

function installMock(opts: { customerExists: boolean; alreadyTagged?: boolean; alreadySubscribed?: boolean }) {
  tokenRequestCount = 0;
  graphqlBodies = [];
  // @ts-expect-error test-only override
  global.fetch = async (url: string, init: any) => {
    if (url.includes("/admin/oauth/access_token")) {
      tokenRequestCount++;
      return new Response(JSON.stringify({ access_token: "fake-token", expires_in: 86399 }), { status: 200 });
    }
    if (url.includes("/admin/api/")) {
      const body = JSON.parse(init.body);
      graphqlBodies.push(body);
      if (body.query.includes("FindCustomer")) {
        return new Response(
          JSON.stringify({
            data: {
              customers: {
                edges: opts.customerExists
                  ? [
                      {
                        node: {
                          id: "gid://shopify/Customer/1",
                          tags: opts.alreadyTagged ? ["marketpulse-lead"] : [],
                          defaultEmailAddress: { marketingState: opts.alreadySubscribed ? "SUBSCRIBED" : "NOT_SUBSCRIBED" },
                        },
                      },
                    ]
                  : [],
              },
            },
          }),
          { status: 200 }
        );
      }
      if (body.query.includes("AddLeadTag")) {
        return new Response(JSON.stringify({ data: { tagsAdd: { userErrors: [] } } }), { status: 200 });
      }
      if (body.query.includes("SubscribeLead")) {
        return new Response(JSON.stringify({ data: { customerEmailMarketingConsentUpdate: { userErrors: [] } } }), { status: 200 });
      }
      if (body.query.includes("CreateLead")) {
        return new Response(
          JSON.stringify({ data: { customerCreate: { customer: { id: "gid://shopify/Customer/2" }, userErrors: [] } } }),
          { status: 200 }
        );
      }
    }
    throw new Error(`Unexpected fetch call: ${url}`);
  };
}

async function run() {
  // Case 1: token is fetched once and reused across multiple recordLead
  // calls within the same warm process (in-memory cache). Must run first,
  // before anything else warms the module-level token cache.
  installMock({ customerExists: false });
  await recordLead("first@example.com");
  await recordLead("second@example.com");
  check("Access token is cached across calls, not re-fetched every time", tokenRequestCount === 1, String(tokenRequestCount));

  // Case 2: new customer -> customerCreate is called with the lead tag AND
  // SUBSCRIBED email marketing consent set at creation time (no separate
  // mutation needed for a brand-new customer).
  installMock({ customerExists: false });
  await recordLead("new-lead@example.com");
  const createCall = graphqlBodies.find((b) => b.query.includes("CreateLead"));
  check("New email triggers customerCreate", !!createCall, JSON.stringify(graphqlBodies.map((b) => b.query.slice(0, 20))));
  check("customerCreate includes the lead tag", createCall?.variables.input.tags.includes("marketpulse-lead"));
  check("customerCreate includes the email", createCall?.variables.input.email === "new-lead@example.com");
  check(
    "customerCreate sets SUBSCRIBED email marketing consent",
    createCall?.variables.input.emailMarketingConsent?.marketingState === "SUBSCRIBED" &&
      createCall?.variables.input.emailMarketingConsent?.marketingOptInLevel === "SINGLE_OPT_IN",
    JSON.stringify(createCall?.variables.input.emailMarketingConsent)
  );
  check("No separate SubscribeLead call needed for a brand-new customer", !graphqlBodies.some((b) => b.query.includes("SubscribeLead")));

  // Case 3: existing, untagged, unsubscribed customer -> both tagsAdd AND
  // the dedicated consent-update mutation fire, not customerCreate.
  installMock({ customerExists: true, alreadyTagged: false, alreadySubscribed: false });
  await recordLead("existing@example.com");
  check("Existing untagged customer triggers tagsAdd", graphqlBodies.some((b) => b.query.includes("AddLeadTag")));
  check("Existing unsubscribed customer triggers SubscribeLead", graphqlBodies.some((b) => b.query.includes("SubscribeLead")));
  check("Existing untagged customer does NOT trigger customerCreate", !graphqlBodies.some((b) => b.query.includes("CreateLead")));
  const subscribeCall = graphqlBodies.find((b) => b.query.includes("SubscribeLead"));
  check(
    "SubscribeLead targets the existing customer's id and sets SUBSCRIBED",
    subscribeCall?.variables.input.customerId === "gid://shopify/Customer/1" &&
      subscribeCall?.variables.input.emailMarketingConsent?.marketingState === "SUBSCRIBED",
    JSON.stringify(subscribeCall?.variables.input)
  );

  // Case 4: already tagged but NOT yet subscribed -> only SubscribeLead
  // fires, tagging is skipped since it's already there.
  installMock({ customerExists: true, alreadyTagged: true, alreadySubscribed: false });
  await recordLead("tagged-not-subscribed@example.com");
  check("Already-tagged, unsubscribed customer skips tagsAdd", !graphqlBodies.some((b) => b.query.includes("AddLeadTag")));
  check("Already-tagged, unsubscribed customer still triggers SubscribeLead", graphqlBodies.some((b) => b.query.includes("SubscribeLead")));

  // Case 5: not yet tagged but already subscribed (e.g. subscribed via some
  // other flow) -> only tagsAdd fires, subscribe is skipped.
  installMock({ customerExists: true, alreadyTagged: false, alreadySubscribed: true });
  await recordLead("subscribed-not-tagged@example.com");
  check("Untagged, already-subscribed customer triggers tagsAdd", graphqlBodies.some((b) => b.query.includes("AddLeadTag")));
  check("Untagged, already-subscribed customer skips SubscribeLead", !graphqlBodies.some((b) => b.query.includes("SubscribeLead")));

  // Case 6: already tagged AND already subscribed -> no mutation at all,
  // just the lookup.
  installMock({ customerExists: true, alreadyTagged: true, alreadySubscribed: true });
  await recordLead("already-tagged@example.com");
  check(
    "Fully up-to-date customer triggers no mutation",
    !graphqlBodies.some((b) => b.query.includes("AddLeadTag")) &&
      !graphqlBodies.some((b) => b.query.includes("SubscribeLead")) &&
      !graphqlBodies.some((b) => b.query.includes("CreateLead"))
  );

  global.fetch = realFetch;

  console.log(`\n${failures === 0 ? "All Shopify lib cases passed." : `${failures} case(s) failed.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

run();
