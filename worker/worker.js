// Shelf Tag price server — a Cloudflare Worker.
// It holds your API keys so they never sit in the public web page, and passes
// price lookups from the app to Kroger (Harris Teeter) and Walmart.
//
// Settings (Cloudflare → your Worker → Settings → Variables and Secrets):
//   APP_KEY               secret  any phrase; the app must send it (stops strangers using your quota)
//   KROGER_CLIENT_ID      text    from developer.kroger.com
//   KROGER_CLIENT_SECRET  secret  from developer.kroger.com
//   ALLOWED_ORIGIN        text    optional, e.g. https://yourname.github.io  (default: any)
//   WALMART_CONSUMER_ID   text    optional, from walmart.io once approved
//   WALMART_PRIVATE_KEY   secret  optional, the private key PEM you generated for walmart.io
//   WALMART_KEY_VERSION   text    optional, defaults to 1
//   KROGER_BASE           text    optional, defaults to https://api.kroger.com

let krogerToken = null; // { token, exp }
let walmartKey = null;  // CryptoKey

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const allowed = String(env.ALLOWED_ORIGIN || '*').split(',').map(s => s.trim()).filter(Boolean);
    const allowOrigin = allowed.includes('*') ? '*' : (allowed.includes(origin) ? origin : allowed[0]);
    const cors = {
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Headers': 'X-App-Key, Content-Type',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin'
    };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const reply = (status, body) => new Response(JSON.stringify(body), {
      status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors }
    });
    if (req.method !== 'GET') return reply(405, { error: 'Only GET is supported.' });
    if (env.APP_KEY && req.headers.get('X-App-Key') !== env.APP_KEY) {
      return reply(401, { error: 'The app key doesn’t match the one on the server.' });
    }

    const url = new URL(req.url);
    const q = url.searchParams;
    try {
      switch (url.pathname.replace(/\/+$/, '') || '/') {
        case '/':
        case '/health':
          return reply(200, {
            ok: true,
            kroger: !!(env.KROGER_CLIENT_ID && env.KROGER_CLIENT_SECRET),
            walmart: !!(env.WALMART_CONSUMER_ID && env.WALMART_PRIVATE_KEY)
          });
        case '/kroger/locations': return reply(200, await krogerLocations(env, q));
        case '/kroger/products':  return reply(200, await krogerProducts(env, q));
        case '/kroger/product':   return reply(200, await krogerProduct(env, q));
        case '/walmart/search':   return reply(200, await walmartSearch(env, q));
        case '/walmart/item':     return reply(200, await walmartItem(env, q));
        default: return reply(404, { error: 'Unknown path.' });
      }
    } catch (e) {
      return reply(e.status || 502, { error: e.message || 'The store’s server didn’t answer.' });
    }
  }
};

function fail(status, message) { const e = new Error(message); e.status = status; return e; }

/* ---------------- Kroger (Harris Teeter, Kroger, Ralphs, Fred Meyer, …) ---------------- */

function krogerBase(env) { return String(env.KROGER_BASE || 'https://api.kroger.com').replace(/\/+$/, ''); }

async function krogerAuth(env, force) {
  if (!env.KROGER_CLIENT_ID || !env.KROGER_CLIENT_SECRET) throw fail(501, 'Kroger keys aren’t set on the price server yet.');
  if (!force && krogerToken && krogerToken.exp > Date.now() + 60000) return krogerToken.token;
  const r = await fetch(krogerBase(env) + '/v1/connect/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + btoa(env.KROGER_CLIENT_ID + ':' + env.KROGER_CLIENT_SECRET)
    },
    body: 'grant_type=client_credentials&scope=product.compact'
  });
  if (!r.ok) throw fail(502, `Kroger sign-in failed (${r.status}). Check the client ID and secret.`);
  const j = await r.json();
  krogerToken = { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 1800) * 1000 };
  return krogerToken.token;
}

async function krogerGet(env, path) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await krogerAuth(env, attempt > 0);
    const r = await fetch(krogerBase(env) + path, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } });
    if (r.status === 401 && attempt === 0) continue;
    if (r.status === 404) throw fail(404, 'Kroger doesn’t have that product at this store.');
    if (r.status === 429) throw fail(429, 'Kroger’s daily limit was reached. Try again tomorrow.');
    if (!r.ok) throw fail(502, `Kroger returned an error (${r.status}).`);
    return r.json();
  }
}

function krogerImage(images) {
  const list = Array.isArray(images) ? images : [];
  const img = list.find(i => i.perspective === 'front') || list[0];
  if (!img || !Array.isArray(img.sizes)) return '';
  const pick = ['medium', 'small', 'thumbnail', 'large'].map(s => img.sizes.find(z => z.size === s)).find(Boolean) || img.sizes[0];
  return pick ? pick.url : '';
}

function mapKroger(p) {
  const it = (p.items || [])[0] || {};
  const pr = it.price || {};
  const regular = Number(pr.regular) > 0 ? Number(pr.regular) : null;
  const promo = Number(pr.promo) > 0 && (!regular || Number(pr.promo) < regular) ? Number(pr.promo) : null;
  return {
    id: p.productId, upc: p.upc || '', name: p.description || '', brand: p.brand || '',
    size: it.size || '', price: regular, promo, image: krogerImage(p.images)
  };
}

async function krogerLocations(env, q) {
  const zip = String(q.get('zip') || '').trim();
  if (!/^\d{5}$/.test(zip)) throw fail(400, 'Enter a 5-digit ZIP code.');
  const radius = Math.min(100, Math.max(1, Number(q.get('radius')) || 15));
  let path = `/v1/locations?filter.zipCode.near=${zip}&filter.radiusInMiles=${radius}&filter.limit=30`;
  if (q.get('chain')) path += '&filter.chain=' + encodeURIComponent(q.get('chain'));
  const j = await krogerGet(env, path);
  return {
    locations: (j.data || []).map(l => {
      const a = l.address || {};
      return { id: l.locationId, chain: l.chain || '', name: l.name || '', address: [a.addressLine1, a.city, a.state].filter(Boolean).join(', ') };
    })
  };
}

async function krogerProducts(env, q) {
  const term = String(q.get('term') || '').trim().split(/\s+/).slice(0, 8).join(' ');
  const loc = String(q.get('locationId') || '').trim();
  if (term.length < 3) throw fail(400, 'Search needs at least 3 letters.');
  if (!/^\w+$/.test(loc)) throw fail(400, 'Pick a Kroger-family store first.');
  const limit = Math.min(20, Math.max(1, Number(q.get('limit')) || 10));
  const j = await krogerGet(env, `/v1/products?filter.term=${encodeURIComponent(term)}&filter.locationId=${loc}&filter.limit=${limit}`);
  return { items: (j.data || []).map(mapKroger) };
}

async function krogerProduct(env, q) {
  const id = String(q.get('id') || '').trim();
  const loc = String(q.get('locationId') || '').trim();
  if (!/^\w+$/.test(id) || !/^\w+$/.test(loc)) throw fail(400, 'Missing product or store.');
  const j = await krogerGet(env, `/v1/products/${id}?filter.locationId=${loc}`);
  return { item: mapKroger(j.data || {}) };
}

/* ---------------- Walmart (Affiliate API, needs approval) ---------------- */

const WALMART_BASE = 'https://developer.api.walmart.com/api-proxy/service/affil/product/v2';

function derLen(n) {
  if (n < 128) return [n];
  const b = []; while (n > 0) { b.unshift(n & 255); n >>= 8; }
  return [0x80 | b.length, ...b];
}
// Walmart's setup guide makes a PKCS#1 key ("BEGIN RSA PRIVATE KEY"); Web Crypto needs PKCS#8.
function pkcs1ToPkcs8(pk1) {
  const version = [0x02, 0x01, 0x00];
  const algId = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const octet = [0x04, ...derLen(pk1.length)];
  const head = [0x30, ...derLen(version.length + algId.length + octet.length + pk1.length), ...version, ...algId, ...octet];
  const out = new Uint8Array(head.length + pk1.length);
  out.set(head, 0); out.set(pk1, head.length);
  return out;
}

async function walmartSign(env, text) {
  if (!walmartKey) {
    const pem = String(env.WALMART_PRIVATE_KEY).replace(/\\n/g, '\n');
    const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
    let der = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    if (/BEGIN RSA PRIVATE KEY/.test(pem)) der = pkcs1ToPkcs8(der);
    walmartKey = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  }
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', walmartKey, new TextEncoder().encode(text)));
  let s = ''; for (const b of sig) s += String.fromCharCode(b);
  return btoa(s);
}

async function walmartGet(env, path) {
  if (!env.WALMART_CONSUMER_ID || !env.WALMART_PRIVATE_KEY) throw fail(501, 'Walmart keys aren’t set on the price server yet.');
  const ts = String(Date.now());
  const ver = String(env.WALMART_KEY_VERSION || '1');
  let signature;
  try { signature = await walmartSign(env, env.WALMART_CONSUMER_ID + '\n' + ts + '\n' + ver + '\n'); }
  catch (e) { walmartKey = null; throw fail(500, 'The Walmart private key couldn’t be read. Paste the whole key, including the BEGIN and END lines.'); }
  const r = await fetch(WALMART_BASE + path, {
    headers: {
      'WM_CONSUMER.ID': env.WALMART_CONSUMER_ID,
      'WM_CONSUMER.INTIMESTAMP': ts,
      'WM_SEC.KEY_VERSION': ver,
      'WM_SEC.AUTH_SIGNATURE': signature,
      Accept: 'application/json'
    }
  });
  if (r.status === 401 || r.status === 403) throw fail(502, 'Walmart rejected the keys. Check the consumer ID, key version and private key.');
  if (r.status === 404) throw fail(404, 'Walmart doesn’t have that product.');
  if (!r.ok) throw fail(502, `Walmart returned an error (${r.status}).`);
  return r.json();
}

function mapWalmart(i) {
  return {
    id: String(i.itemId || ''), upc: i.upc || '', name: i.name || '', brand: i.brandName || '',
    size: i.size || '', price: Number(i.salePrice) > 0 ? Number(i.salePrice) : null, promo: null,
    image: i.thumbnailImage || i.mediumImage || ''
  };
}

async function walmartSearch(env, q) {
  const term = String(q.get('q') || '').trim();
  if (term.length < 3) throw fail(400, 'Search needs at least 3 letters.');
  const j = await walmartGet(env, `/search?query=${encodeURIComponent(term)}&numItems=10`);
  return { items: (j.items || []).map(mapWalmart) };
}

async function walmartItem(env, q) {
  const id = String(q.get('id') || '').trim();
  if (!/^\d+$/.test(id)) throw fail(400, 'Missing product.');
  const j = await walmartGet(env, `/items?ids=${id}`);
  const raw = Array.isArray(j.items) ? j.items[0] : j;
  if (!raw || !raw.itemId) throw fail(404, 'Walmart doesn’t have that product.');
  return { item: mapWalmart(raw) };
}

// Exposed for tests only.
export const _test = { mapKroger, mapWalmart, pkcs1ToPkcs8, reset: () => { krogerToken = null; walmartKey = null; } };
