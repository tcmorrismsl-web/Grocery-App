# Shelf Tag

A personal grocery app for iPhone: shopping list, pantry and fridge tracker, store-by-store price comparison, and health scores for what you buy.

It's a single-page web app (plain HTML, CSS and JavaScript, no build step). Host it on GitHub Pages, open it in Safari, and add it to your Home Screen so it runs full screen like a regular app. A small optional price server (a free Cloudflare Worker) pulls live prices.

## What it does

- **List**: add items, check them off in the store, and see where the list is cheapest (each store's total, plus the cheapest split across stores). "Log this trip" records what you bought and what you paid, and stocks the pantry.
- **Running low**: learns how fast you go through each item from your trip history and flags it a few days before it's likely to run out.
- **Buy again**: one tap to re-add anything you've bought, or a whole past trip.
- **Pantry**: what's on hand in the pantry, fridge and freezer. Tap − when you finish one.
- **Prices**: latest price at Harris Teeter, Food Lion, Walmart, Publix and Sam's Club for each item, cheapest highlighted. Live prices are marked with a green dot.
- **Health**: weekly, monthly and yearly average health score (1–100) of everything bought, weighted by quantity.
- **Health scores** come from [Open Food Facts](https://world.openfoodfacts.org) (Nutri-Score) by barcode lookup, camera scan, or name search, or you can type one in.

## Where prices come from

| Store | Source |
| --- | --- |
| Harris Teeter | **Live**, through Kroger's free developer API (Kroger owns Harris Teeter). Regular price plus the sale price, which the app treats as the VIC card price. |
| Walmart | **Live once approved**, through the Walmart Affiliate API. Gives Walmart's online price. |
| Food Lion | Prices you log. No public API. |
| Publix | Prices you log. No public API. |
| Sam's Club | Prices you log. No public API. |

Logging a trip saves what you paid at that store, so manual prices fill in as you shop.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | The whole app |
| `manifest.webmanifest` | Home Screen name, icon and colors |
| `sw.js` | Offline support (caches the app after first open) |
| `icons/` | App icons |
| `worker/worker.js` | The price server (Cloudflare Worker) |
| `worker/wrangler.toml` | Only for deploying the price server from a computer |
| `tools/make_icons.py` | Redraws the icons (needs Python + Pillow) |

## Step 1: Put the app on GitHub Pages

The code lives in [tcmorrismsl-web/Grocery-App](https://github.com/tcmorrismsl-web/Grocery-App). Nothing in it is secret (API keys live only on the price server), so the repo can be public.

1. GitHub Pages is free for public repos; private repos need a paid GitHub plan. To make it public: repo **Settings → General → Danger Zone → Change visibility → Public**.
2. In the repo, go to **Settings → Pages**. Under "Build and deployment", choose **Deploy from a branch**, branch `main`, folder `/ (root)`, and save.
3. After a minute the site is live at `https://tcmorrismsl-web.github.io/Grocery-App/`.
4. On your iPhone, open that link in **Safari**, tap Share → **Add to Home Screen**.

The app opens with sample data. Tap **Start fresh** to clear it (your five stores are kept).

## Step 2: Get Kroger API keys (for Harris Teeter)

1. Go to [developer.kroger.com](https://developer.kroger.com) and create a free account.
2. Create (register) a new application. Pick the **Production** environment if asked.
3. Give it access to the public **Products** and **Locations** APIs.
4. If it asks for a redirect URL, enter `http://localhost` (the price server doesn't use it).
5. Copy the **Client ID** and **Client Secret**. Treat the secret like a password.

## Step 3: Set up the price server on Cloudflare (free)

This keeps your Kroger secret off the public web page. It works from a phone browser but is easier on a computer.

1. Sign up at [dash.cloudflare.com](https://dash.cloudflare.com) (free plan).
2. Go to **Workers & Pages → Create → Create Worker**. Name it `shelf-tag-prices` and click **Deploy**.
3. Click **Edit code**, delete what's there, paste in the whole contents of `worker/worker.js`, and click **Deploy**.
4. Go to the Worker's **Settings → Variables and Secrets** and add:

   | Name | Type | Value |
   | --- | --- | --- |
   | `APP_KEY` | Secret | Any long phrase you make up. The app sends it so nobody else can use your server. |
   | `KROGER_CLIENT_ID` | Text | From step 2 |
   | `KROGER_CLIENT_SECRET` | Secret | From step 2 |
   | `ALLOWED_ORIGIN` | Text | `https://tcmorrismsl-web.github.io` (recommended) |

   Save and deploy.
5. Copy the Worker's address, which looks like `https://shelf-tag-prices.<something>.workers.dev`. Opening it in a browser should say the app key doesn't match. That means it's running.

## Step 4: Connect the app

1. In Shelf Tag, tap the settings button (top right).
2. Under **Live prices**, paste the Worker address and your `APP_KEY`, then tap **Test connection**. It should say "Connected. Kroger keys set."
3. Under **Stores**, tap **Connect live prices** on Harris Teeter, enter your ZIP, and pick your store.
4. Go to **Prices**, open an item, and tap **Find match** next to Harris Teeter. Pick the matching product. Do this once per item; after that its price updates on its own.

Prices refresh automatically when you open the app (at most every 6 hours), or tap **Update live prices** on the Prices tab. Kroger allows about 10,000 product lookups a day, far more than you'll use.

## Optional: Walmart

Walmart's API is part of its affiliate program, so it needs an approved account:

1. Apply for the Walmart Affiliate Program, then sign in at [walmart.io](https://walmart.io).
2. Follow Walmart's steps to generate a key pair and upload the public key. Note the **Consumer ID** and **key version**.
3. Add these to the Worker's Variables and Secrets: `WALMART_CONSUMER_ID` (Text), `WALMART_PRIVATE_KEY` (Secret: paste the whole private key including the BEGIN and END lines), and `WALMART_KEY_VERSION` (Text, usually `1`).
4. In the app, tap **Connect live prices** on Walmart and choose **Use Walmart prices**, then match items the same way.

Approval isn't guaranteed for personal use. Until then, Walmart works like the other logged stores.

## Your data

Everything is stored on the phone in Safari's storage for that site. Nothing is sent anywhere except barcode lookups to Open Food Facts and price lookups to your own price server.

- **Back up** from Settings → Export backup. Deleting the Home Screen app or clearing Safari data erases it. The backup includes your app key.
- **Share with someone in the household**: export on one phone, import on the other. Each phone keeps its own copy after that.

## Updating the app

Edit `index.html`, then in `sw.js` bump `CACHE` (for example `shelftag-v2` → `shelftag-v3`) and commit both. Phones pick up the new version the next time the app opens with a connection. If you change `worker/worker.js`, paste it into the Cloudflare editor again and deploy.

## Ideas for later

- Real-time sync between two phones (Supabase or Firebase free tier).
- Food Lion, Publix and Sam's Club prices: none have a public API. Scraping their sites breaks their terms and gets blocked, so these stay manual.
