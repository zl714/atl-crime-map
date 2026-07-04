#!/usr/bin/env python3
"""Fetch Atlanta crime/public-safety news from local RSS feeds, classify each
story, geocode a location, and write a compact data/live.json.

Runs in GitHub Actions (stdlib only, no API key). Because CI has no LLM, the
classifier is a transparent keyword matcher and the geocoder is Nominatim with a
persisted cache (data/geocache.json) — an LLM step is unnecessary for this and
would add a paid dependency. The layer is always labeled "media reports"; each
item keeps its source and link so provenance stays visible.

Run: python3 data/fetch_news.py
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path
from xml.etree import ElementTree as ET

HERE = Path(__file__).resolve().parent
LIVE_PATH = HERE / "live.json"
CACHE_PATH = HERE / "geocache.json"
HOODS_PATH = HERE / "neighborhoods.geojson"

UA = "atl-crime-map/1.0 (portfolio; lecroyzack@gmail.com)"
WINDOW_HOURS = 24
MAX_ITEMS = 60
ATL_VIEWBOX = "-85.1,34.5,-83.7,33.2"  # left,top,right,bottom (lon/lat) metro Atlanta

FEEDS = [
    ("WSB-TV", "https://www.wsbtv.com/arc/outboundfeeds/rss/?outputType=xml"),
    ("11Alive", "https://www.11alive.com/feeds/syndication/rss/news/crime"),
    ("FOX5 Atlanta", "https://www.fox5atlanta.com/rss/category/news"),
]

# Non-crime sections: Atlanta stations file sports/entertainment recaps on the
# same wire, and phrases like "shot" or "killed it" false-positive the keyword
# classifier. Reject by URL section before classifying.
SKIP_URL_RE = re.compile(
    r"/(sports?|mlb|nfl|nba|nhl|mls|braves|falcons|hawks|entertainment|"
    r"lifestyle|food|recipes|events|contests|deals|steals)(/|$)",
    re.IGNORECASE,
)

# Keyword classifier: does a headline describe a crime / public-safety incident?
CRIME_TERMS = [
    "shot", "shooting", "gunfire", "gunman", "gun ", "shots fired", "drive-by",
    "homicide", "murder", "killed", "fatal", "dead", "body found", "death",
    "stabbing", "stabbed", "robbery", "robbed", "armed", "carjack", "burglary",
    "burglar", "assault", "shootout", "standoff", "swat", "manhunt", "suspect",
    "arrested", "arrest", "kidnap", "abduct", "rape", "sexual assault",
    "shooting death", "wounded", "injured", "gang", "weapon", "wanted",
    "police", "officer", "deputy", "detective", "investigating", "crime",
    "theft", "stolen", "shoplifting", "fraud", "trafficking", "overdose",
    "hit-and-run", "hit and run", "pedestrian struck", "fatal crash",
    "deadly crash", "missing", "amber alert", "shooting investigation",
]
# Offense typing (first match wins) for the marker/popup label.
TYPE_RULES = [
    ("Shooting", ["shot", "shooting", "gunfire", "gunman", "shots fired", "drive-by", "wounded"]),
    ("Homicide", ["homicide", "murder", "killed", "fatal", "body found", "shooting death", "deadly"]),
    ("Stabbing", ["stabbing", "stabbed"]),
    ("Robbery", ["robbery", "robbed", "armed", "carjack"]),
    ("Burglary/Theft", ["burglary", "burglar", "theft", "stolen", "shoplifting"]),
    ("Assault", ["assault", "rape", "sexual assault"]),
    ("Standoff/SWAT", ["standoff", "swat", "manhunt", "barricad"]),
    ("Missing person", ["missing", "amber alert", "abduct", "kidnap"]),
    ("Traffic incident", ["hit-and-run", "hit and run", "pedestrian struck", "crash", "collision"]),
    ("Drugs", ["trafficking", "overdose", "narcotic", "drug"]),
]

METRO_CITIES = [
    "Atlanta", "Sandy Springs", "Roswell", "Marietta", "Smyrna", "Alpharetta",
    "Johns Creek", "Dunwoody", "Brookhaven", "Chamblee", "Doraville", "Decatur",
    "East Point", "College Park", "Union City", "Fairburn", "Hapeville",
    "Forest Park", "Riverdale", "Jonesboro", "Morrow", "Stockbridge", "McDonough",
    "Stone Mountain", "Tucker", "Lithonia", "Clarkston", "Avondale Estates",
    "Kennesaw", "Acworth", "Powder Springs", "Austell", "Mableton", "Douglasville",
    "Lithia Springs", "Lawrenceville", "Duluth", "Norcross", "Suwanee", "Snellville",
    "Peachtree Corners", "Buford", "Sugar Hill", "Cumming", "Woodstock", "Canton",
    "Dallas", "Hiram", "Cartersville", "Peachtree City", "Fayetteville", "Newnan",
    "Conyers", "Covington", "Buckhead", "Midtown", "Downtown Atlanta",
]
COUNTIES = [
    "Fulton County", "DeKalb County", "Cobb County", "Cherokee County",
    "Paulding County", "Bartow County", "Clayton County", "Gwinnett County",
    "Henry County", "Douglas County", "Fayette County", "Rockdale County",
]
HIGHWAY_RE = re.compile(
    r"\b(I-?285|I-?75|I-?85|I-?20|GA-?400|Georgia 400|Ga\. 400|Downtown Connector|"
    r"Perimeter|Buford Highway|Memorial Drive|Peachtree(?: Street| Road)?|"
    r"Ponce de Leon|Camp Creek(?: Parkway)?|Fulton Industrial|Cascade Road)\b",
    re.IGNORECASE,
)
STREET_RE = re.compile(
    r"\b([A-Z][a-zA-Z.]+(?:\s[A-Z][a-zA-Z.]+){0,3}\s"
    r"(?:Road|Rd|Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Parkway|Pkwy|"
    r"Highway|Hwy|Lane|Ln|Way|Trail|Circle|Court|Ct))\b"
)


def load_gazetteer():
    names = list(METRO_CITIES) + list(COUNTIES)
    try:
        gj = json.loads(HOODS_PATH.read_text())
        for f in gj.get("features", []):
            nm = (f.get("properties", {}) or {}).get("NhoodName")
            if nm:
                names.append(nm)
    except Exception:
        pass
    # Longer names first so "College Park" wins over "Park".
    return sorted(set(names), key=len, reverse=True)


def classify(text):
    low = text.lower()
    if not any(term in low for term in CRIME_TERMS):
        return None
    for label, kws in TYPE_RULES:
        if any(k in low for k in kws):
            return label
    return "Public safety"


def extract_location(text, gazetteer):
    m = HIGHWAY_RE.search(text)
    if m:
        return m.group(0)
    for name in gazetteer:
        if re.search(r"\b" + re.escape(name) + r"\b", text, re.IGNORECASE):
            return name
    # Street-only matches count only when the story also names Atlanta, so a
    # same-named road in another state can't slip into the metro feed.
    m = STREET_RE.search(text)
    if m and re.search(r"\batlanta\b", text, re.IGNORECASE):
        return m.group(1)
    return None


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def strip_html(s):
    s = re.sub(r"<[^>]+>", "", s or "")
    return re.sub(r"\s+", " ", s).strip()


def parse_feed(source, xml_bytes):
    out = []
    root = ET.fromstring(xml_bytes)
    for it in root.findall(".//item"):
        title = strip_html(it.findtext("title") or "")
        link = (it.findtext("link") or "").strip()
        desc = strip_html(it.findtext("description") or "")
        pub = it.findtext("pubDate") or it.findtext(
            "{http://purl.org/dc/elements/1.1/}date"
        )
        try:
            dt = parsedate_to_datetime(pub) if pub else None
            if dt and dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
        except Exception:
            dt = None
        out.append({"source": source, "title": title, "link": link,
                    "desc": desc, "dt": dt})
    return out


class Geocoder:
    def __init__(self):
        try:
            self.cache = json.loads(CACHE_PATH.read_text())
        except Exception:
            self.cache = {}
        self.dirty = False

    def geocode(self, text):
        key = text.strip().lower()
        if key in self.cache:
            return self.cache[key]
        params = {
            "q": f"{text}, Georgia, USA",
            "format": "json",
            "limit": "1",
            "viewbox": ATL_VIEWBOX,
            "bounded": "1",
        }
        url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(params)
        result = None
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            time.sleep(1.1)  # Nominatim: max ~1 req/sec
            data = json.load(urllib.request.urlopen(req, timeout=30))
            if data:
                result = [round(float(data[0]["lat"]), 5), round(float(data[0]["lon"]), 5)]
        except Exception as e:
            print(f"  geocode failed for {text!r}: {e}", file=sys.stderr)
        self.cache[key] = result
        self.dirty = True
        return result

    def save(self):
        if self.dirty:
            CACHE_PATH.write_text(json.dumps(self.cache, separators=(",", ":")))


def main():
    gazetteer = load_gazetteer()
    cutoff = datetime.now(timezone.utc) - timedelta(hours=WINDOW_HOURS)
    raw = []
    for source, url in FEEDS:
        try:
            raw.extend(parse_feed(source, fetch(url)))
            print(f"{source}: fetched")
        except Exception as e:
            print(f"{source}: FAILED {e}", file=sys.stderr)

    # Dedupe by link, keep incident stories within the window.
    seen = set()
    items = []
    for r in raw:
        if not r["link"] or r["link"] in seen:
            continue
        if r["dt"] and r["dt"] < cutoff:
            continue
        if SKIP_URL_RE.search(urllib.parse.urlparse(r["link"]).path):
            continue
        offense = classify(f"{r['title']} {r['desc']}")
        if not offense:
            continue
        seen.add(r["link"])
        items.append({**r, "type": offense})

    items.sort(key=lambda r: r["dt"] or datetime.min.replace(tzinfo=timezone.utc),
               reverse=True)
    items = items[:MAX_ITEMS]

    geo = Geocoder()
    news = []
    located = 0
    for r in items:
        loc = extract_location(f"{r['title']}. {r['desc']}", gazetteer)
        # Geofence: the feed is labeled "Live · Atlanta", so stories that
        # never name a metro-Atlanta place (Dearborn, I-45, Spalding...) are
        # dropped instead of shown under an Atlanta banner.
        if not loc:
            continue
        # A bare "Atlanta" mention can't be pinned to a point — geocoding it
        # drops a misleading marker on downtown. Keep the item, skip the pin.
        coord = None if loc.lower() == "atlanta" else geo.geocode(loc)
        if coord:
            located += 1
        news.append({
            "source": r["source"],
            "title": r["title"],
            "link": r["link"],
            "summary": r["desc"][:200],
            "type": r["type"],
            "location_text": loc,
            "lat": coord[0] if coord else None,
            "lon": coord[1] if coord else None,
            "published": int(r["dt"].timestamp() * 1000) if r["dt"] else None,
        })
    geo.save()

    payload = {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "label": "media reports",
        "news_count": len(news),
        "located_count": located,
        "news": news,
    }
    LIVE_PATH.write_text(json.dumps(payload, separators=(",", ":")))
    print(f"\nWrote {len(news)} news items ({located} geocoded) to {LIVE_PATH}")


if __name__ == "__main__":
    main()
