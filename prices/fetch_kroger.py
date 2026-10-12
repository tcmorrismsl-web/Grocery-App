#!/usr/bin/env python3
"""Builds the daily Harris Teeter price list (kroger.json) from Kroger's public API.

Runs in GitHub Actions (.github/workflows/prices.yml). Reads:
  prices/config.json   which store (ZIP code, or a Kroger location ID)
  prices/terms.txt     what to search for, one term per line
  env KROGER_CLIENT_ID / KROGER_CLIENT_SECRET   repo secrets
  --prev               last published kroger.json, so products that drop out of
                       today's search results keep their last known price for a while

Always writes --out/kroger.json, even on failure (with an "error" field and the
previous products), so the app can say what went wrong.
Python standard library only.
"""
import argparse
import base64
import datetime as dt
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
BASE = os.environ.get("KROGER_BASE", "https://api.kroger.com").rstrip("/")
FIELDS = ["id", "name", "brand", "size", "price", "promo", "seen"]


class Fail(Exception):
    pass


def read_config():
    with open(os.path.join(ROOT, "config.json"), encoding="utf-8") as f:
        cfg = json.load(f)
    cfg.setdefault("zip", "")
    cfg.setdefault("locationId", "")
    cfg.setdefault("chain", "Harris Teeter")
    cfg.setdefault("radiusMiles", 15)
    cfg.setdefault("pagesPerTerm", 2)
    cfg.setdefault("keepDays", 30)
    return cfg


def read_terms():
    out, seen = [], set()
    with open(os.path.join(ROOT, "terms.txt"), encoding="utf-8") as f:
        for line in f:
            t = line.split("#", 1)[0].strip()
            t = " ".join(t.split()[:8])
            if len(t) >= 3 and t.lower() not in seen:
                seen.add(t.lower())
                out.append(t)
    return out


class Kroger:
    def __init__(self, cid, secret):
        self.cid, self.secret, self.token, self.calls = cid, secret, None, 0

    def auth(self):
        basic = base64.b64encode(f"{self.cid}:{self.secret}".encode()).decode()
        req = urllib.request.Request(
            BASE + "/v1/connect/oauth2/token",
            data=b"grant_type=client_credentials&scope=product.compact",
            headers={"Authorization": "Basic " + basic,
                     "Content-Type": "application/x-www-form-urlencoded"},
            method="POST")
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                self.token = json.load(r)["access_token"]
        except urllib.error.HTTPError as e:
            raise Fail(f"Kroger sign-in failed ({e.code}). Check the KROGER_CLIENT_ID and "
                       "KROGER_CLIENT_SECRET repo secrets.")

    def get(self, path, params=None):
        url = BASE + path + ("?" + urllib.parse.urlencode(params) if params else "")
        for attempt in range(5):
            if not self.token:
                self.auth()
            req = urllib.request.Request(url, headers={"Authorization": "Bearer " + self.token,
                                                       "Accept": "application/json"})
            self.calls += 1
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    return json.load(r)
            except urllib.error.HTTPError as e:
                if e.code == 401 and attempt == 0:
                    self.token = None
                    continue
                if e.code == 404:
                    return None
                if e.code == 429 or e.code >= 500:
                    time.sleep(min(60, 5 * (attempt + 1) ** 2))
                    continue
                raise Fail(f"Kroger returned {e.code} for {path}.")
            except (urllib.error.URLError, TimeoutError):
                time.sleep(5 * (attempt + 1))
        raise Fail(f"Kroger kept failing for {path}; try again later.")


def addr(loc):
    a = loc.get("address") or {}
    return ", ".join(x for x in [a.get("addressLine1"), a.get("city"), a.get("state")] if x)


def slim_loc(loc):
    return {"id": loc.get("locationId", ""), "name": loc.get("name", ""),
            "chain": loc.get("chain", ""), "address": addr(loc)}


def pick_store(api, cfg):
    want = cfg["chain"].lower().replace(" ", "")
    if cfg["locationId"]:
        j = api.get(f"/v1/locations/{cfg['locationId']}")
        if not j or not j.get("data"):
            raise Fail(f"Kroger has no store with location ID {cfg['locationId']}. "
                       "Fix locationId in prices/config.json, or clear it and set your ZIP.")
        return slim_loc(j["data"]), []
    z = str(cfg["zip"]).strip()
    if not (len(z) == 5 and z.isdigit()):
        raise Fail("Set your 5-digit ZIP code in prices/config.json.")
    j = api.get("/v1/locations", {"filter.zipCode.near": z,
                                  "filter.radiusInMiles": int(cfg["radiusMiles"]),
                                  "filter.limit": 50}) or {}
    locs = j.get("data") or []
    match = [l for l in locs
             if want in (l.get("chain", "") + l.get("name", "")).lower().replace(" ", "")]
    if not match:
        near = "; ".join(f"{l.get('name')} ({l.get('locationId')})" for l in locs[:5]) or "none"
        raise Fail(f"No {cfg['chain']} within {cfg['radiusMiles']} miles of {z}. "
                   f"Nearest Kroger-family stores: {near}.")
    return slim_loc(match[0]), [slim_loc(l) for l in match[:8]]


def map_product(p, today):
    it = (p.get("items") or [{}])[0]
    pr = it.get("price") or {}
    reg = pr.get("regular") or 0
    promo = pr.get("promo") or 0
    reg = round(float(reg), 2) if reg and float(reg) > 0 else None
    promo = round(float(promo), 2) if promo and float(promo) > 0 and (reg is None or float(promo) < reg) else None
    if reg is None and promo is None:
        return None  # not sold at this store
    return [p.get("productId", ""), (p.get("description") or "").strip(), (p.get("brand") or "").strip(),
            (it.get("size") or "").strip(), reg, promo, today]


def load_prev(path):
    try:
        with open(path, encoding="utf-8") as f:
            j = json.load(f)
        return j if isinstance(j.get("products"), list) else None
    except Exception:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prev", default="")
    ap.add_argument("--out", default="out")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    now = dt.datetime.now(dt.timezone.utc)
    today = now.astimezone(dt.timezone(dt.timedelta(hours=-5))).date().isoformat()
    prev = load_prev(a.prev) if a.prev else None
    feed = {"version": 1, "updated": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "fields": FIELDS,
            "store": prev.get("store") if prev else None, "nearby": prev.get("nearby", []) if prev else [],
            "products": prev["products"] if prev else [], "error": None, "stats": {}}
    code = 0
    try:
        cfg = read_config()
        terms = read_terms()
        cid, sec = os.environ.get("KROGER_CLIENT_ID", "").strip(), os.environ.get("KROGER_CLIENT_SECRET", "").strip()
        if not cid or not sec:
            raise Fail("Kroger keys aren't added yet. Add KROGER_CLIENT_ID and KROGER_CLIENT_SECRET under "
                       "the repo's Settings → Secrets and variables → Actions.")
        api = Kroger(cid, sec)
        store, nearby = pick_store(api, cfg)
        if feed["store"] and feed["store"].get("id") != store["id"]:
            feed["products"] = []  # different store: old prices don't apply
        feed["store"], feed["nearby"] = store, nearby or feed["nearby"]

        found = {}
        pages = max(1, min(5, int(cfg["pagesPerTerm"])))
        for t in terms:
            for page in range(pages):
                q = {"filter.term": t, "filter.locationId": store["id"], "filter.limit": 50}
                if page:
                    q["filter.start"] = page * 50  # number of results to skip
                j = api.get("/v1/products", q) or {}
                data = j.get("data") or []
                for p in data:
                    row = map_product(p, today)
                    if row and row[0]:
                        found[row[0]] = row
                if len(data) < 50:
                    break

        if not found:
            raise Fail("Kroger returned no priced products for this store. Check the store in prices/config.json.")

        cutoff = (dt.date.fromisoformat(today) - dt.timedelta(days=int(cfg["keepDays"]))).isoformat()
        carried = 0
        for row in feed["products"]:
            if row and row[0] not in found and len(row) == len(FIELDS) and str(row[6]) >= cutoff:
                found[row[0]] = row
                carried += 1
        feed["products"] = sorted(found.values(), key=lambda r: r[1].lower())
        feed["stats"] = {"terms": len(terms), "calls": api.calls, "products": len(feed["products"]),
                         "carried": carried}
        print(f"{store['name']} ({store['id']}): {len(feed['products'])} products "
              f"({carried} carried over), {api.calls} API calls")
    except Fail as e:
        feed["error"] = str(e)
        print("::warning::" + str(e))
    except Exception as e:  # unexpected: keep the old list, record the error, fail the run
        feed["error"] = f"The price update failed unexpectedly: {e}"
        print("::error::" + feed["error"])
        code = 1
    with open(os.path.join(a.out, "kroger.json"), "w", encoding="utf-8") as f:
        json.dump(feed, f, separators=(",", ":"), ensure_ascii=False)
    return code


if __name__ == "__main__":
    sys.exit(main())
