# Hosting StackScan on your Shopify store

Shopify only serves Liquid templates and static assets — it can't run the
Next.js backend (it needs to resolve DNS and make server-side HTTP requests
for the SSRF checks in `lib/ssrf-guard.ts`, which a storefront theme can't
do). So the architecture is:

```
Shopify page (theme/Liquid)  --fetch()-->  StackScan on Vercel (does the real scan)
```

The Vercel side is the app already in this project. The Shopify side is a
small snippet that calls it. Two options below — pick one.

## Step 1 — deploy the backend (required either way)

1. Push this project to a GitHub repo.
2. vercel.com → **Add New Project** → import the repo → Deploy. Framework
   auto-detects as Next.js, no env vars required to deploy.
3. Note your deployment URL, e.g. `https://stackscan-yourname.vercel.app`.
4. **If using Option A (native embed) below**, also set an environment
   variable on the Vercel project: Project Settings → Environment Variables →
   add `ALLOWED_ORIGINS` = `https://yourstore.com,https://yourstore.myshopify.com`
   (both your custom domain and the `.myshopify.com` domain, comma-separated,
   no spaces, no trailing slash). Redeploy after adding it — env var changes
   need a redeploy to take effect.

## Option A — native embed (recommended)

Renders as plain HTML/CSS in your theme, so it can match your store's look.
Calls the Vercel API in the background.

1. In `shopify/custom-liquid-embed.html`, replace `API_BASE` (near the top
   of the `<script>` block) with your Vercel URL from Step 1.
2. Shopify Admin → **Online Store → Themes → Customize**.
3. Navigate to the page you want it on. Click **Add section** (or **Add
   block** if adding inside an existing section) and look for **Custom
   Liquid** — this is a built-in block on Online Store 2.0 themes, no theme
   code editing required.
4. Paste the entire contents of `custom-liquid-embed.html` into it. Save.
5. Load the page and test a scan. If you get a "Network error" message,
   double check `ALLOWED_ORIGINS` on Vercel matches the exact origin the
   page loads from (including `https://`, no trailing slash) and that you
   redeployed after setting it.

If your theme predates Online Store 2.0 and has no "Custom Liquid" option,
edit theme code directly instead: **Themes → Edit code**, open the template
for that page (or a section file it includes), and paste the block's
contents in directly.

## Option B — iframe (fastest, unstyled)

Live in 2 minutes, but it renders StackScan's own UI in a frame rather than
matching your theme, and doesn't need any CORS/env var setup.

1. In `shopify/iframe-embed.html`, replace the `src` with your Vercel URL.
2. Shopify Admin → **Online Store → Pages** → open (or create) the page →
   in the content editor, use the **Show HTML** (`</>`) toggle if your theme
   editor has one, and paste the iframe. If your editor strips `<iframe>`
   tags, use a **Custom Liquid** block instead (see Option A, step 3) and
   paste it there — Custom Liquid blocks don't sanitize the markup.

## Which to pick

Option A if you want it to look native to your store and are comfortable
setting one env var on Vercel. Option B if you just want it live today and
don't mind it looking like an embedded tool rather than part of the page.
You can start with B and swap to A later — the backend doesn't change.
