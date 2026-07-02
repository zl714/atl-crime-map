#!/usr/bin/env python3
"""Fetch and preprocess Atlanta Police Department crime incidents.

Source: APD Open Data "OpenDataWebsite_Crime_view" FeatureServer (NIBRS data).
Pulls the trailing WINDOW_DAYS of incidents, maps NIBRS buckets into four
analyst-facing categories, and writes a compact data/incidents.json.

Run: python3 data/fetch_incidents.py
"""
import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

SERVICE = (
    "https://services3.arcgis.com/Et5Qfajgiyosiw4d/arcgis/rest/services/"
    "OpenDataWebsite_Crime_view/FeatureServer/0/query"
)
WINDOW_DAYS = 180
PAGE_SIZE = 2000
OUT_PATH = Path(__file__).resolve().parent / "incidents.json"

OUT_FIELDS = [
    "OBJECTID",
    "OccurredFromDate",
    "NIBRS_Bucket",
    "NIBRS_Offense",
    "Crime_Against",
    "FireArmInvolved",
    "NhoodName",
    "NPU",
    "Zone",
    "StreetAddress",
    "LocationType",
    "Latitude",
    "Longitude",
]

# Map APD NIBRS_Bucket values -> four analyst categories used by the app.
CATEGORY_MAP = {
    # violent (crimes against person)
    "Homicide": "violent",
    "Aggravated Assault": "violent",
    "Assault Offenses": "violent",
    "Robbery": "violent",
    "Rape": "violent",
    "Sex Offenses": "violent",
    "Kidnapping/Abduction": "violent",
    # vehicle-related
    "Auto Theft": "vehicle",
    "Theft From Auto": "vehicle",
    # property
    "Burglary": "property",
    "Shoplifting": "property",
    "All Other Larceny": "property",
    "Stolen Property Offenses": "property",
    "Damage to Property": "property",
    "Arson": "property",
    "Embezzelment": "property",
    "Fraud Offenses": "property",
    "Counterfeiting/Forgery": "property",
    "Extortion/Blackmail": "property",
}
# Everything else (drugs, weapons, animal cruelty, all other offenses, etc.)
# falls through to "other".


def categorize(bucket):
    return CATEGORY_MAP.get(bucket, "other")


def fetch_page(offset):
    params = {
        "where": f"OccurredFromDate > CURRENT_TIMESTAMP - INTERVAL '{WINDOW_DAYS}' DAY "
        "AND Latitude IS NOT NULL AND Longitude IS NOT NULL",
        "outFields": ",".join(OUT_FIELDS),
        "orderByFields": "OBJECTID ASC",
        "resultOffset": offset,
        "resultRecordCount": PAGE_SIZE,
        "returnGeometry": "false",
        "f": "json",
    }
    url = SERVICE + "?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=60) as resp:
        return json.load(resp)


def clean(rows):
    out = []
    for r in rows:
        a = r["attributes"]
        lat, lon = a.get("Latitude"), a.get("Longitude")
        if lat is None or lon is None:
            continue
        # Atlanta metro bounding box sanity check.
        if not (32.5 <= lat <= 34.5 and -85.5 <= lon <= -83.5):
            continue
        ts = a.get("OccurredFromDate")
        if not ts:
            continue
        date_iso = datetime.fromtimestamp(ts / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
        bucket = a.get("NIBRS_Bucket") or "Unknown"
        out.append(
            {
                "lat": round(lat, 5),
                "lon": round(lon, 5),
                "date": date_iso,
                "ts": int(ts),
                "cat": categorize(bucket),
                "type": bucket,
                "offense": a.get("NIBRS_Offense") or bucket,
                "hood": (a.get("NhoodName") or "").strip() or "Unknown",
                "npu": (a.get("NPU") or "").strip(),
                "zone": (a.get("Zone") or "").strip(),
                "addr": (a.get("StreetAddress") or "").strip(),
                "loc": (a.get("LocationType") or "").strip(),
                "firearm": (a.get("FireArmInvolved") or "").strip().lower() in ("yes", "true", "y"),
            }
        )
    return out


def main():
    print(f"Fetching last {WINDOW_DAYS} days from APD Crime FeatureServer...")
    all_rows = []
    offset = 0
    while True:
        data = fetch_page(offset)
        if "error" in data:
            print("API error:", data["error"], file=sys.stderr)
            sys.exit(1)
        feats = data.get("features", [])
        if not feats:
            break
        all_rows.extend(feats)
        print(f"  offset {offset}: +{len(feats)} (total {len(all_rows)})")
        if not data.get("exceededTransferLimit") and len(feats) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
        time.sleep(0.15)

    records = clean(all_rows)
    records.sort(key=lambda r: r["ts"])
    dates = [r["date"] for r in records]

    payload = {
        "meta": {
            "source": "Atlanta Police Department Open Data (NIBRS Crime Incidents)",
            "service": SERVICE.replace("/query", ""),
            "retrieved": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "window_days": WINDOW_DAYS,
            "count": len(records),
            "date_min": dates[0] if dates else None,
            "date_max": dates[-1] if dates else None,
        },
        "incidents": records,
    }
    OUT_PATH.write_text(json.dumps(payload, separators=(",", ":")))
    size_mb = OUT_PATH.stat().st_size / 1e6
    print(f"\nWrote {len(records)} incidents to {OUT_PATH} ({size_mb:.2f} MB)")
    print(f"Date range: {payload['meta']['date_min']} to {payload['meta']['date_max']}")


if __name__ == "__main__":
    main()
