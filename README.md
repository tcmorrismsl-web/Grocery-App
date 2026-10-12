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
| Harris Teeter | **Daily**, through Kroger's free developer API (Kroger owns Harris Teeter). A GitHub Action in this repo pulls your store's prices every morning. Regular price plus the sale price, which the app treats as the VIC card price. |
| Walmart | **Live once approved**, through the Walmart Affiliate API and the optional price server. Gives Walmart's online price. |
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
| `prices/config.json` | Which Harris Teeter: your ZIP code, or a specific Kroger store ID |
| `prices/terms.txt` | What the daily update searches for, one per line |
| `prices/fetch_kroger.py` | The daily price job |
| `.github/workflows/prices.yml` | Runs the job every morning and publishes `kroger.json` to the `data` branch |
| `worker/worker.js` | Optional price server (Cloudflare Worker) for Walmart and instant searches |
| `worker/wrangler.toml` | Only for deploying the price server from a computer |
| `tools/make_icons.py` | Redraws the icons (needs Python + Pillow) |

## Step 1: Put the app on GitHub Pages

The code lives in [tcmorrismsl-web/Grocery-App](https://github.com/tcmorrismsl-web/Grocery-App). Nothing in it is secret (the Kroger keys live in GitHub's encrypted repo secrets), so the repo can be public.

1. GitHub Pages is free for public repos; private repos need a paid GitHub plan. To make it public: repo **Settings → General → Danger Zone → Change visibility → Public**.
2. In the repo, go to **Settings → Pages**. Under "Build and deployment", choose **Deploy from a branch**, branch `main`, folder `/ (root)`, and save.
3. After a minute the site is live at `https://tcmorrismsl-web.github.io/Grocery-App/`.
4. On your iPhone, open that link in **Safari**, tap Share → **Add to Home Screen**.

The app opens with sample data. Tap **Start fresh** to clear it (your five stores are kept).

## Step 2: Get Kroger API keys (for Harris Teeter)

1. Go to [developer.kroger.com](https://developer.kroger.com) and create a free account.
2. Create (register) a new application. Pick the **Production** environment if asked.
3. Give it access to the public **Products** and **Locations** APIs.
4. If it asks for a redirect URL, enter `http://localhost` (nothing uses it).
5. Copy the **Client ID** and **Client Secret**. Treat the secret like a password.

## Step 3: Add the keys to GitHub

1. In the repo, go to **Settings → Secrets and variables → Actions → New repository secret**.
2. Add `KROGER_CLIENT_ID` with the Client ID, then `KROGER_CLIENT_SECRET` with the Client Secret.

GitHub encrypts these; they never appear in the code or the app.

## Step 4: Pick your store and run it

1. Open [`prices/config.json`](https://github.com/tcmorrismsl-web/Grocery-App/edit/main/prices/config.json), put your ZIP code in `"zip"`, and commit. The job uses the nearest Harris Teeter to that ZIP.
2. Saving that file starts the price job. Watch it under the repo's **Actions** tab ("Update Harris Teeter prices"). It takes a few minutes. After that it runs every morning around 6 am.
3. Open the app. Harris Teeter connects to the daily list on its own. In **Settings**, tap **Match my items**: it matches each item to the Harris Teeter product with the same name. Open any item on the **Prices** tab to check its match, or tap **Change** to pick another.

To use a different Harris Teeter than the nearest one, look at the job's log in the Actions tab or the `nearby` list in [`kroger.json`](https://github.com/tcmorrismsl-web/Grocery-App/blob/data/kroger.json), copy the store's `id` into `"locationId"` in `config.json`, and commit.

If an item says it isn't in the daily price list, add a search word for it to [`prices/terms.txt`](https://github.com/tcmorrismsl-web/Grocery-App/edit/main/prices/terms.txt) and commit. The job reruns right away. Each word pulls up to 100 products; the starter list has about 170 words (about 350 Kroger lookups a run, out of 10,000 allowed a day). Products that drop out of the search keep their last price for 30 days.

The app reads the list each time it opens. **Settings → Check for new prices** reloads it on demand. Any problem (missing keys, no store found) shows under **Daily Harris Teeter prices** in Settings.

## Optional: price server (Cloudflare)

Only needed for Walmart, or for searching all of Harris Teeter instantly instead of the daily list.

1. Sign up at [dash.cloudflare.com](https://dash.cloudflare.com) (free plan).
2. Go to **Workers & Pages → Create → Create Worker**. Name it `shelf-tag-prices` and click **Deploy**.
3. Click **Edit code**, delete what's there, paste in the whole contents of `worker/worker.js`, and click **Deploy**.
4. Go to the Worker's **Settings → Variables and Secrets** and add:

   | Name | Type | Value |
   | --- | --- | --- |
   | `APP_KEY` | Secret | Any long phrase you make up. The app sends it so nobody else can use your server. |
   | `KROGER_CLIENT_ID` | Text | From step 2 |
   | `KROGER_CLIENT_SECRET` | Secret | From step 2 |
   | `ALLOWED_ORIGIN` | Text | `https://tcmorrismsl-web.github.io` |

   Save and deploy.
5. In the app's **Settings → Price server**, paste the Worker's address (`https://shelf-tag-prices.<something>.workers.dev`) and your `APP_KEY`, then tap **Test connection**.

## Optional: Walmart

Walmart's API is part of its affiliate program, so it needs an approved account:

1. Apply for the Walmart Affiliate Program, then sign in at [walmart.io](https://walmart.io).
2. Follow Walmart's steps to generate a key pair and upload the public key. Note the **Consumer ID** and **key version**.
3. Set up the optional price server above, then add these to the Worker's Variables and Secrets: `WALMART_CONSUMER_ID` (Text), `WALMART_PRIVATE_KEY` (Secret: paste the whole private key including the BEGIN and END lines), and `WALMART_KEY_VERSION` (Text, usually `1`).
4. In the app, tap **Connect live prices** on Walmart and choose **Use Walmart prices**, then match items the same way.

Approval isn't guaranteed for personal use. Until then, Walmart works like the other logged stores.

## Your data

Everything is stored on the phone in Safari's storage for that site. The app only downloads: the daily price list from this repo, barcode lookups from Open Food Facts, and (if set up) prices from your own price server. Nothing about your list, pantry or trips leaves the phone.

- **Back up** from Settings → Export backup. Deleting the Home Screen app or clearing Safari data erases it. If you set up the price server, the backup includes its app key.
- **Share with someone in the household**: export on one phone, import on the other. Each phone keeps its own copy after that.

## Updating the app

Edit `index.html`, then in `sw.js` bump `CACHE` (for example `shelftag-v2` → `shelftag-v3`) and commit both. Phones pick up the new version the next time the app opens with a connection. If you change `worker/worker.js`, paste it into the Cloudflare editor again and deploy.

## Ideas for later

- Real-time sync between two phones (Supabase or Firebase free tier).
- Food Lion, Publix and Sam's Club prices: none have a public API. Scraping their sites breaks their terms and gets blocked, so these stay manual.
