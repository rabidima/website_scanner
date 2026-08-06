/**
 * Minimal Shopify Admin API client for lead capture only. Every scanned-and-
 * unlocked email gets written to Shopify as a customer tagged
 * "marketpulse-lead" — that's it. No orders, no subscriptions, no billing:
 * the product gate itself runs entirely off the signed cookie in lib/gate.ts,
 * this is purely so captured emails land in your existing Shopify customer
 * list for remarketing later.
 *
 * Auth: client credentials grant (Dev Dashboard app, same org as the store,
 * no OAuth redirect needed). Access tokens expire every 24h and are cached
 * in-memory with a refresh-on-expiry check. See:
 * https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant
 *
 * Env vars required:
 *   SHOPIFY_SHOP_DOMAIN     e.g. "your-store.myshopify.com"
 *   SHOPIFY_CLIENT_ID       from Dev Dashboard -> your app -> Settings
 *   SHOPIFY_CLIENT_SECRET   from Dev Dashboard -> your app -> Settings
 *   SHOPIFY_API_VERSION     optional, defaults to 2026-07
 */

const DEFAULT_API_VERSION = "2026-07";
const LEAD_TAG = "marketpulse-lead";

// In-memory token cache. Lives for the life of a warm serverless instance;
// a cold start just re-fetches. Same best-effort-per-instance pattern as the
// rate limiters in the API routes.
let cachedToken: { accessToken: string; expiresAt: number } | null = null;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured on this deployment.`);
  return value;
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt - Date.now() > 60_000) {
    return cachedToken.accessToken;
  }

  const shop = requireEnv("SHOPIFY_SHOP_DOMAIN");
  const clientId = requireEnv("SHOPIFY_CLIENT_ID");
  const clientSecret = requireEnv("SHOPIFY_CLIENT_SECRET");

  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Shopify token request failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.accessToken;
}

async function shopifyGraphQL<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const shop = requireEnv("SHOPIFY_SHOP_DOMAIN");
  const version = process.env.SHOPIFY_API_VERSION || DEFAULT_API_VERSION;
  const token = await getAccessToken();

  const res = await fetch(`https://${shop}/admin/api/${version}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Shopify Admin API error (${res.status}): ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors && json.errors.length > 0) {
    throw new Error(`Shopify GraphQL error: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  if (!json.data) {
    throw new Error("Shopify GraphQL response had no data.");
  }
  return json.data;
}

interface CustomerLookupResponse {
  customers: { edges: Array<{ node: { id: string; tags: string[] } }> };
}

interface CustomerCreateResponse {
  customerCreate: { customer: { id: string } | null; userErrors: Array<{ message: string }> };
}

interface TagsAddResponse {
  tagsAdd: { userErrors: Array<{ message: string }> };
}

/**
 * Finds a customer by email and tags them as a lead, or creates a new
 * tagged customer if none exists. Idempotent — safe to call every time an
 * email clears the gate, not just the first time.
 */
export async function recordLead(email: string): Promise<void> {
  const lookup = await shopifyGraphQL<CustomerLookupResponse>(
    `query FindCustomer($query: String!) {
      customers(first: 1, query: $query) {
        edges { node { id tags } }
      }
    }`,
    { query: `email:${email}` }
  );

  const existing = lookup.customers.edges[0]?.node;

  if (existing) {
    if (existing.tags.includes(LEAD_TAG)) return; // already tagged, nothing to do
    const result = await shopifyGraphQL<TagsAddResponse>(
      `mutation AddLeadTag($id: ID!, $tags: [String!]!) {
        tagsAdd(id: $id, tags: $tags) {
          userErrors { message }
        }
      }`,
      { id: existing.id, tags: [LEAD_TAG] }
    );
    if (result.tagsAdd.userErrors.length > 0) {
      throw new Error(`Shopify tagsAdd error: ${result.tagsAdd.userErrors.map((e) => e.message).join("; ")}`);
    }
    return;
  }

  const created = await shopifyGraphQL<CustomerCreateResponse>(
    `mutation CreateLead($input: CustomerInput!) {
      customerCreate(input: $input) {
        customer { id }
        userErrors { message }
      }
    }`,
    { input: { email, tags: [LEAD_TAG] } }
  );
  if (created.customerCreate.userErrors.length > 0) {
    throw new Error(`Shopify customerCreate error: ${created.customerCreate.userErrors.map((e) => e.message).join("; ")}`);
  }
}

/**
 * Fire-and-forget wrapper for use in request handlers: never lets a Shopify
 * failure block unlocking the gate for the user. Logs failures server-side
 * so they're visible in Vercel logs for a manual retry/backfill later.
 */
export function recordLeadBestEffort(email: string): void {
  recordLead(email).catch((err) => {
    console.error("Shopify lead capture failed (non-blocking):", email, err);
  });
}
