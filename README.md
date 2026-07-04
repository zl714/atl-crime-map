# Atlanta Crime Intelligence Map

A full-screen, dark-themed situational-awareness map for City of Atlanta crime
incidents — built in the spirit of [liveuamap.com](https://liveuamap.com), but
for metro-Atlanta public-safety data. Incidents are plotted as color-coded
bubbles over a dark basemap, with a live intelligence panel that recomputes
totals, a firearm-involvement KPI, category breakdowns, a 7-day trend, top
neighborhoods, and a day-of-week × hour temporal grid for whatever is in view.

Live: **[atl-crime-map.vercel.app](https://atl-crime-map.vercel.app)**

Built by **Zachary LeCroy** to demonstrate crime-analysis and GIS skills.
Not affiliated with the City of Atlanta, the Atlanta Police Department, or any
agency.

![Atlanta Crime Intelligence Map](docs/screenshot.jpg)

The app has two top-level modes, switched instantly from the header (linkable as
`#crime` / `#traffic`):

_Traffic mode — live GDOT 511 roadway events with its own intel panel; optional camera layer traces the highway network:_

![Traffic mode](docs/screenshot-traffic.jpg)

| Firearm-only view | Neighborhood choropleth | Hotspot heatmap |
| --- | --- | --- |
| ![Firearms only](docs/screenshot-firearm.jpg) | ![Choropleth](docs/screenshot-choropleth.jpg) | ![Heatmap](docs/screenshot-heatmap.jpg) |

## Data

- **Source:** [Atlanta Police Department Open Data](https://opendata.atlantapd.org/) —
  live NIBRS Crime Incidents FeatureServer
  (`services3.arcgis.com/Et5Qfajgiyosiw4d/.../OpenDataWebsite_Crime_view`).
- **Neighborhood boundaries:** APD Open Data `neighborhood` FeatureServer
  (242 City-of-Atlanta neighborhood polygons), generalized to a 118 KB GeoJSON.
- **Records:** 29,188 incidents (points with valid coordinates), 1,239
  firearm-involved.
- **Date range:** 2026-01-04 → 2026-07-02 (trailing ~180 days).
- **Retrieved:** 2026-07-03. The site shows a "Data updated" stamp read from the
  JSON, and a GitHub Action refreshes the data daily (see below).
- Real, incident-level data only — nothing is fabricated. Locations are snapped
  to the nearest street/block by APD for anonymity, and house numbers are
  redacted at the source.

To re-pull fresh data, see [`data/REFRESH.md`](data/REFRESH.md). The whole
pipeline is one stdlib-only script:

```bash
python3 data/fetch_incidents.py
```

## Features

- **Dark full-screen map** (Leaflet + CartoDB `dark_all` tiles) centered on
  Atlanta, canvas-rendered so ~30k points stay smooth.
- **Color-coded incident bubbles** by offense category — violent, property,
  vehicle, other — subtly sized by recency (newer = larger). Categories are
  always paired with a labeled legend, never color alone.
- **Firearm prominence.** Firearm-involved incidents wear a bright red-orange
  ring that reads against any category color, at any zoom. A headline KPI shows
  the firearm count and % of the current view; a **Firearms only** filter
  isolates them; the neighborhood table and incident popups carry firearm
  counts/badges.
- **Intelligence panel** that recomputes as you pan/zoom/filter:
  - total incidents in view + firearm KPI,
  - category breakdown with proportional bars,
  - 7-day trend sparkline with day-over-week delta,
  - **top-10 neighborhoods** in view, each with its firearm count and a
    last-30d-vs-prior-30d trend arrow (click to focus the map on it),
  - a **day-of-week × hour** temporal grid (7×24, Atlanta local time) shaded by
    density — the classic crime-analysis "when" chart — which respects the
    firearm filter so you can see when gun incidents cluster,
  - a recent-incident feed (offense, neighborhood, date; firearm flagged).
- **Neighborhood analytics.** A **Neighborhoods** choropleth shades the 242
  Atlanta neighborhoods by filtered incident count (sequential dark→amber ramp),
  and clicking a neighborhood — on the map or in the top-10 list — filters the
  whole app to it (click again to clear).
- **Filters:** category toggles, firearms-only, date-range chips
  (30d / 90d / 6mo / All), a **heatmap** hotspot toggle, and the neighborhood
  choropleth toggle.
- **Incident popups** with offense, date, neighborhood, APD zone, place type,
  and a firearm-involved badge.
- **Two modes** via a header segmented control (instant swap, no reload;
  linkable as `#crime` / `#traffic`):
  - **Crime** — everything above, plus a live **media reports** (news) layer and
    **NWS weather alerts**, with a "Live · Atlanta" feed and a pulsing LIVE
    header indicator.
  - **Traffic** — a dedicated live view of GDOT 511 roadway events with its own
    intel panel (active count, breakdown by type, worst corridors, latest-event
    feed) and an optional traffic-camera layer. See below.
- **Shareable views:** `?lat=&lon=&z=&heat=1&choro=1&firearm=1` deep-links to a
  specific location/zoom and pre-set layers/filters; `#crime` / `#traffic`
  selects the mode; `?cam=1#traffic` opens traffic mode with cameras on.

## Live data (both modes)

Atlanta publishes **no** real-time CAD/911 feed, so nothing here pretends to be
one. Instead, genuinely live public sources power the two modes. Each map symbol
is a distinct glyph so nothing is confused with a NIBRS incident bubble (a
filled circle).

**Crime mode** carries two live layers:

| Layer | Glyph | Source | Fetch | Cadence |
| --- | --- | --- | --- | --- |
| **Media reports** (news) | amber diamond | WSB-TV, 11Alive, FOX5 Atlanta RSS | cron → `data/live.json`, client reads it from `raw.githubusercontent.com` | every 10 min |
| **Weather alerts** | severity-shaded polygon | `api.weather.gov` active alerts | client-side (CORS) | on load + every 3 min |

**Traffic mode** is a separate, dedicated view (not a layer on the crime map):

| Element | Glyph | Source | Fetch | Cadence |
| --- | --- | --- | --- | --- |
| **Roadway events** (wrecks, closures, roadwork, special events) | triangle, colored by type/severity | GDOT 511 Events Public View (GEMA ArcGIS) | client-side (CORS) | on load + every 3 min |
| **Traffic cameras** (optional toggle) | small dot | GDOT Live Traffic Cameras (GEMA ArcGIS) | client-side (CORS) | on demand |

Its intel panel shows the active-event count, a breakdown by type, the worst
corridors by event count, and a latest-events feed with time-ago. ~2,000 metro
cameras trace the highway network when toggled on. **Camera snapshots are not
embedded**: GDOT hosts the snapshot images without TLS, so they would be blocked
as mixed content on the HTTPS site — the popup links out to the live 511 camera
instead (with a graceful `<img>` attempt that hides on failure).

**Why the fetch split.** `api.weather.gov` and the GDOT ArcGIS services all send
`Access-Control-Allow-Origin: *`, so the browser fetches them directly — always
current. News RSS is CORS-blocked and needs geocoding, so a GitHub Action
(`.github/workflows/live.yml`) fetches + processes it every 10 minutes and
commits `data/live.json`. The client reads that file from
`raw.githubusercontent.com/zl714/atl-crime-map/main/data/live.json` (CORS `*`,
~5-min CDN cache), so **cron updates appear without any redeploy** (falling back
to the same-origin copy if raw is unreachable). The GDOT 511 official API needs
a developer key; this uses the keyless public GEMA-hosted ArcGIS view instead.

**News processing (`data/fetch_news.py`).** Runs in CI with the Python standard
library only — no API key. Each story is classified as an incident by a
transparent keyword matcher, a location is extracted (Atlanta neighborhood /
city / county / highway / street gazetteer), and geocoded with **Nominatim**
(≤1 req/sec, results cached in `data/geocache.json` so repeat headlines are not
re-queried). An LLM step (e.g. `claude -p`) was considered per the original
brief but rejected for the automated path: CI has no model access, and a tuned
keyword + gazetteer + Nominatim pipeline is deterministic, free, and good enough
for headline triage. Un-geocoded stories still appear in the feed, just without
a map marker.

**Honesty.** The news layer is labelled **"media reports"** everywhere, and every
item keeps its source tag and a link to the original story. News headlines are
not confirmed incidents and are presented as such.

## Firearm involvement — method

The `firearm` flag comes **directly from APD's `FireArmInvolved` field**, not
from inference. It is well-populated and internally consistent, so no string
derivation is applied:

- 4.2% of all incidents (1,239 / 29,188) are firearm-involved.
- The flag tracks offense type as expected: Weapon-Law Violations 96%, Homicide
  83%, Aggravated Assault 46%, Robbery 38%, and ~0% for property/fraud offenses.

Deriving involvement from offense strings (e.g. treating every "Weapon Law
Violation" as a gun) was considered and **rejected** — it would misclassify
non-firearm weapon offenses and inflate the count. The native field is the
accurate source.

## Categories

APD `NIBRS_Bucket` values are mapped into four analyst categories:

| Category | Color     | Includes (examples)                                          |
| -------- | --------- | ------------------------------------------------------------ |
| Violent  | `#F23645` | Homicide, Aggravated Assault, Robbery, Rape, Sex Offenses    |
| Property | `#F59E0B` | Burglary, Larceny, Shoplifting, Fraud, Damage to Property    |
| Vehicle  | `#60A5FA` | Auto Theft, Theft From Auto                                  |
| Other    | `#94A3B8` | Drug/Narcotic, Weapon-Law, Animal Cruelty, All Other Offenses|

Firearm involvement is orthogonal to category and rendered as a separate
red-orange ring (`#FF5A1F`), reserved exclusively for that purpose.

## Neighborhood join

Incidents carry an APD `NhoodName`; the boundary layer uses the same field, so
the join is mostly exact. Match rate: **~91% of all incidents** join to a
polygon (about **97%** of incidents that have a known neighborhood — 8% of
records have no APD neighborhood and are excluded from neighborhood analytics).
A small alias table (see `js/config.js`) patches the largest label mismatches
(e.g. "Historic Westin Heights/Bankhead" → "Bankhead"). Well above the 80%
threshold, so the choropleth is enabled.

## Automation

- `.github/workflows/refresh.yml` re-pulls the NIBRS incidents daily (10:00 UTC)
  and commits `data/incidents.json` when it changes.
- `.github/workflows/live.yml` re-pulls + geocodes news every 10 minutes and
  commits `data/live.json` (read live from raw.githubusercontent, no redeploy
  needed).
- The Vercel project is connected to this GitHub repo, so pushes to `main`
  auto-deploy to production. See [`SETUP.md`](SETUP.md) for details and the
  token-based fallback.

## Time zone note

APD returns occurrence times as true-UTC epochs. The preprocessor converts each
to **America/New_York** before deriving the date, day-of-week, and hour — so the
temporal grid reflects Atlanta wall-clock time. This was validated against APD's
own `Day_of_the_week` field (Eastern-derived day matches 100% of sampled
records; a naive UTC read matches only 79.5%).

## Run locally

Static site — no build step. Serve the directory over HTTP so the browser can
fetch the JSON/GeoJSON:

```bash
python3 -m http.server 8899 --directory .
# then open http://localhost:8899
```

## Tech notes

- **Vanilla JS (ES modules), no frameworks.** `Leaflet` for the map,
  `Leaflet.heat` for the hotspot layer — both from CDN.
- Rendering: separate Leaflet canvas renderers on dedicated panes (choropleth
  under bubbles, firearm halos under the colored bubble). Filtering toggles
  marker membership in place rather than rebuilding, and the in-view panel
  recompute is coalesced to one pass per animation frame.
- Design system (LeCroy brand): navy near-black surfaces, a slate text ramp,
  amber (`#F59E0B`) as the single interactive accent, red-orange reserved for
  firearms, 1px hairline borders, Geist type, tabular-nums on all figures, a 4px
  spacing grid, and 6–12px radii.

## Project layout

```
atl-crime-map/
├── index.html
├── css/styles.css
├── js/
│   ├── app.js          # orchestrator: data -> map -> panel -> controls
│   ├── config.js       # categories, colors, firearm/choropleth config, aliases
│   ├── data.js         # fetch incidents + neighborhoods, name normalization
│   ├── mapview.js      # Leaflet map, bubbles, firearm halos, heat, choropleth
│   ├── panel.js        # in-view stats, firearm KPI, top hoods, time grid, feed
│   ├── live.js         # crime-mode live layers: news + NWS weather + feed
│   ├── traffic.js      # traffic mode: GDOT 511 events, cameras, intel panel
│   └── controls.js     # category / firearm / date / heat / choropleth controls
├── data/
│   ├── incidents.json        # preprocessed incidents (generated, daily)
│   ├── neighborhoods.geojson  # 242 Atlanta neighborhood polygons
│   ├── atl_counties.geojson   # 8 metro county polygons (for zone alerts)
│   ├── live.json              # news feed (generated every 10 min)
│   ├── geocache.json          # persisted Nominatim cache
│   ├── fetch_incidents.py
│   ├── fetch_news.py
│   └── REFRESH.md
├── .github/workflows/
│   ├── refresh.yml     # daily incident refresh
│   └── live.yml        # 10-min news refresh
├── SETUP.md
└── docs/               # screenshots
```
